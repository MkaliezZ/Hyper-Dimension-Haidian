import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipFiles } from '../tools/pack.mjs';
import { validateAnnualDocument } from '../src/platform/annual-contract.mjs';
const python = process.env.HD_QA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
test('Material conversion preserves needs, rating conditions and alternative paths without executing HTML or inventing blank work', async () => {
  const parent = resolve('.local');
  await mkdir(parent, { recursive: true });
  const temp = await mkdtemp(join(parent, 'annual-conversion-'));
  assert(temp.startsWith(parent + sep));
  try {
    const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="B1"><v>8</v></c><c r="C1"><v>9</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Freshman</t></is></c><c r="B2" t="inlineStr"><is><t>活动：虚构迎新\n公域：虚构公开指南\n私域：虚构群内答疑</t></is></c><c r="C2" t="inlineStr"><is><t>活动：\n公域：\n私域：</t></is></c></row></sheetData></worksheet>`;
    const files = [
      [
        'xl/workbook.xml',
        Buffer.from(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ops" r:id="one"/></sheets></workbook>',
        ),
      ],
      [
        'xl/_rels/workbook.xml.rels',
        Buffer.from(
          '<Relationships><Relationship Id="one" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
      ],
      ['xl/worksheets/sheet1.xml', Buffer.from(xml)],
    ];
    const xlsx = join(temp, 'source.xlsx'),
      html = join(temp, 'source.html'),
      out = join(temp, 'conversion');
    await zipFiles(files, xlsx);
    const calendar = {
      title: '虚构年历',
      version: 'synthetic-1',
      updated: '2026-10-24',
      checked: '2026-10-23',
      grades: [['Freshman', '大一', '示例地区', '示例阶段']],
      sources: [],
      assumptions: ['不是必做清单'],
      variants: [['一年制示例', '使用本人的真实结束日期']],
      examples: [['同一主线', '已完成应解除紧急评级']],
      definition: [['客观事件', '不评级']],
      timing: { A: { name: '重要且紧急', rule: '本人实际截止临近', action: '完成后解除评级' } },
      events: [
        {
          id: 'fresh-8',
          grade: 'Freshman',
          month: 8,
          category: '学业事件',
          title: '虚构选课节点',
          need: '理解虚构学分要求',
          timing: 'A',
          chain: '课程',
          eventWindow: '本校实际选课窗口',
          bestWindow: '提前准备',
          processWindow: '选课到反馈',
          directImpact: '本学期',
          downstream: '下一阶段按需复查',
          applicability: '仅为虚构情境',
          ratingCondition: '已完成或不适用则移除，不照搬A',
          sourceIds: [],
          basis: '原创测试',
          impactMechanism: '虚构课程衔接',
        },
      ],
    };
    await writeFile(
      html,
      '<script>throw Error("NEVER_EXECUTE")</script><script type="application/json">' +
        JSON.stringify(calendar) +
        '</script>',
    );
    const run = (destination, extra = []) =>
      spawnSync(
        python,
        [
          'tools/prepare-annual-materials.py',
          '--xlsx',
          xlsx,
          '--html',
          html,
          '--out',
          destination,
          ...extra,
        ],
        { encoding: 'utf8' },
      );
    let r = run(out);
    assert.equal(r.status, 0, r.stderr);
    const school = validateAnnualDocument(
        JSON.parse(await readFile(join(out, 'student-union-annual.json'), 'utf8')),
      ),
      needs = validateAnnualDocument(
        JSON.parse(await readFile(join(out, 'student-needs-annual.json'), 'utf8')),
      );
    assert.equal(school.entries.length, 3);
    assert.equal(school.references.length, 1);
    assert(school.entries.every((e) => e.month === 8));
    assert.deepEqual(
      new Set(school.entries.map((e) => e.channel)),
      new Set(['event', 'public', 'private']),
    );
    assert.equal(needs.entries[0].studentNeed, calendar.events[0].need);
    assert(needs.entries[0].applicability.includes(calendar.events[0].ratingCondition));
    assert(needs.assumptions.some((x) => x.includes('一年制示例') && x.includes('真实结束日期')));
    assert(needs.assumptions.some((x) => x.includes('示例地区') && x.includes('示例阶段')));
    assert(needs.assumptions.some((x) => x.includes('完成后解除评级')));
    assert(needs.assumptions.some((x) => x.includes('synthetic-1')));
    const verify = () =>
      spawnSync(
        python,
        ['tools/verify-annual-materials.py', '--xlsx', xlsx, '--html', html, '--converted', out],
        { encoding: 'utf8' },
      );
    r = verify();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      JSON.parse(await readFile(join(out, 'source-fidelity.json'), 'utf8')).status,
      'PASS',
    );
    const original = await readFile(join(out, 'student-needs-annual.json'));
    const missingCondition = JSON.parse(original);
    missingCondition.entries[0].applicability = calendar.events[0].applicability;
    await writeFile(join(out, 'student-needs-annual.json'), JSON.stringify(missingCondition));
    assert.notEqual(
      verify().status,
      0,
      'Missing individual rating conditions must fail source verification',
    );
    await writeFile(join(out, 'student-needs-annual.json'), original);
    r = run(out);
    assert.notEqual(r.status, 0);
    assert.deepEqual(await readFile(join(out, 'student-needs-annual.json')), original);
    r = run(join(temp, 'version-two'), ['--version', '2']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      JSON.parse(await readFile(join(temp, 'version-two/student-needs-annual.json'))).version,
      2,
    );
  } finally {
    assert(temp.startsWith(parent + sep));
    await rm(temp, { recursive: true });
  }
});
