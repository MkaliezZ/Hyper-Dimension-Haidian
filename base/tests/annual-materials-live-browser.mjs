import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { config, fixtures, login, api } from './m1-helpers.mjs';
import { validateAnnualDocument, annualPeriod } from '../src/platform/annual-contract.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  process.env.HD_ACTUAL_MATERIALS_TEST !== '1' ||
  !process.env.HD_QA_CHROME ||
  !process.env.HD_MATERIALS_DIR ||
  new URL(config.origin).hostname !== '127.0.0.1' ||
  !fixtures.every((x) => x.email.endsWith('@m0.invalid'))
)
  throw Error(
    'Explicit private-material QA flag, loopback fictitious stack, owned browser and private directory required',
  );
const input = resolve(process.env.HD_MATERIALS_DIR),
  qa = join(input, 'qa');
await mkdir(qa, { recursive: true });
const read = async (p) => JSON.parse(await readFile(p, 'utf8')),
  book = validateAnnualDocument(await read(join(input, 'student-union-annual.json'))),
  calendar = validateAnnualDocument(await read(join(input, 'student-needs-annual.json'))),
  fidelity = await read(join(input, 'source-fidelity.json'));
assert.equal(fidelity.status, 'PASS');
assert.equal(book.entries.length, 82);
assert.equal(calendar.entries.length, 432);
const [owner, alice, bob] = await Promise.all(['moda', 'alice', 'bob'].map(login)),
  org = 'materials-' + randomUUID().slice(0, 8),
  base = '/annual/schools/north/organizations/' + org,
  checks = [];
const pool = new pg.Pool({ connectionString: config.databaseUrl });
let browser;
const ok = (r) => {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  },
  post = async (u, p, b) => ok(await api(u, p, { requestId: randomUUID(), ...b }));
const count = async (table) =>
  Number(
    (
      await pool.query(
        'SELECT count(*) AS n FROM ' +
          table +
          " WHERE school_id='north' AND " +
          (table === 'hd_activities' ? 'org_id' : 'scope_id') +
          '=$1',
        [org],
      )
    ).rows[0].n,
  );
const idle = async (p) => p.locator('#scope:enabled').waitFor();
async function pageFor(name) {
  const context = await browser.newContext({ viewport: { width: 1380, height: 1000 } }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((x) => x.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/annual.html');
  await page.locator('#scope option[value="' + org + '"]').waitFor({ state: 'attached' });
  await idle(page);
  await page.locator('#scope').selectOption(org);
  await idle(page);
  return { context, page };
}
async function choose(p, pkg) {
  await p.locator('#package').selectOption(pkg);
  await idle(p);
}
async function filter(p, { cohort = 'freshman', month = '8', category = '', channel = '' } = {}) {
  await p.locator('#cohort').selectOption(cohort);
  await p.locator('#month').selectOption(month);
  await p.locator('#category').selectOption(category);
  await p.locator('#channel').selectOption(channel);
  await p.locator('#filters button').click();
}
const errors = [];
try {
  await post(owner, '/m1/schools/north/organizations', {
    orgId: org,
    name: '私有材料隔离验收 ' + org,
    kind: 'student',
  });
  const invite = await post(owner, '/m1/schools/north/organizations/' + org + '/invitations', {
    email: 'alice@m0.invalid',
    role: 'member',
  });
  ok(await api(alice, '/m1/invitations/accept', { token: invite.token }));
  for (const d of [book, calendar]) {
    const preview = ok(await api(owner, base + '/preview', { document: d }));
    assert.deepEqual(preview.document, d);
    assert.equal(preview.effects.publishesContent, 0);
    assert.equal(preview.effects.issuesRewards, 0);
  }
  const v = ok(await api(owner, base + '/preview', { document: calendar }));
  await post(owner, base + '/import', {
    document: calendar,
    previewHash: v.documentHash,
    expectedLatestVersion: 0,
    confirmed: true,
    reason: '完整用户材料的隔离技术验收，不是实际学校批准',
  });
  assert.equal((await api(alice, base + '/catalog?packageId=' + calendar.packageId)).status, 409);
  assert.equal((await api(bob, base + '/packages')).status, 403);
  checks.push(
    'both full documents pass real backend preview, no side effects, calendar immutable import; draft and cross-school access denied',
  );
  browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
  const admin = await pageFor('moda'),
    p = admin.page;
  await p.locator('#file').setInputFiles(join(input, 'student-union-annual.json'));
  await idle(p);
  await p.locator('#preview-import').click();
  await idle(p);
  assert.match(await p.locator('#import-preview').textContent(), /previousVersion/);
  await p.locator('#reason').fill('完整表格材料的隔离导入验收，不是真实学校发布');
  await p.locator('#confirm-import').check();
  await p.locator('#import').click();
  await idle(p);
  assert.match(await p.locator('#status').textContent(), /新版本已导入/);
  const stored = ok(
    await api(owner, base + '/versions/' + book.packageId + '?version=' + book.version),
  );
  assert.deepEqual(stored.document, book);
  await p.locator('#version').selectOption(book.packageId + ':' + book.version);
  await p.locator('#confirm-activate').check();
  await p.locator('#activate').click();
  await idle(p);
  assert.match(await p.locator('#counts').textContent(), /82/);
  assert.equal(await p.locator('#entries article').count(), 24);
  const firstIndex = book.entries.findIndex((e) => e.targetBase === 1 && e.channel === 'public'),
    secondIndex = book.entries.findIndex(
      (e, i) => i >= 24 && e.targetBase === 4 && e.channel === 'event',
    );
  assert(firstIndex >= 0 && firstIndex < 24);
  assert(secondIndex >= 24);
  const first = book.entries[firstIndex].entryId,
    second = book.entries[secondIndex].entryId;
  await p.locator('[data-plan-entry="' + first + '"]').check();
  for (let i = 0; i < Math.floor(secondIndex / 24); i++) await p.locator('#next-page').click();
  await p.locator('[data-plan-entry="' + second + '"]').check();
  assert.match(await p.locator('#selected-count').textContent(), /已选 2 项/);
  const activitiesBefore = await count('hd_activities'),
    scoresBefore = await count('hd_contributions');
  await p.locator('#preview-plan').click();
  await idle(p);
  await p.locator('#confirm-plan').check();
  await p.locator('#clear-selection').click();
  assert.equal(await p.locator('#confirm-plan').isChecked(), false);
  await p.locator('#confirm-plan').check();
  await p.locator('#commit-plan').click();
  await idle(p);
  assert.match(await p.locator('#status').textContent(), /请先预览/);
  assert.equal(await count('hd_annual_tasks'), 0);
  await p.locator('#previous-page').click();
  while (!(await p.locator('[data-plan-entry="' + first + '"]').count()))
    await p.locator('#previous-page').click();
  await p.locator('[data-plan-entry="' + first + '"]').check();
  for (let i = 0; i < Math.floor(secondIndex / 24); i++) await p.locator('#next-page').click();
  await p.locator('[data-plan-entry="' + second + '"]').check();
  await p.locator('#preview-plan').click();
  await idle(p);
  await p.locator('#confirm-plan').check();
  await p.locator('#commit-plan').click();
  await idle(p);
  assert.match(await p.locator('#status').textContent(), /运营事项已建立/);
  const tasks = ok(
    await api(
      owner,
      base + '/tasks?packageId=' + book.packageId + '&academicYear=' + new Date().getFullYear(),
    ),
  ).tasks;
  assert.equal(tasks.length, 2);
  for (const task of tasks) {
    assert([first, second].includes(task.entry_id));
    const entry = book.entries.find((e) => e.entryId === task.entry_id);
    assert.deepEqual(task.snapshot, entry);
    assert.equal(task.period, annualPeriod(new Date().getFullYear(), book.startMonth, entry.month));
    assert.equal(task.due_at, null);
    assert.equal(task.date_verified, false);
  }
  assert.equal(await count('hd_activities'), activitiesBefore);
  assert.equal(await count('hd_contributions'), scoresBefore);
  const guideTask = tasks.find((t) => t.entry_id === first),
    serviceTask = tasks.find((t) => t.entry_id === second);
  assert.equal(
    await p
      .locator('[data-task="' + guideTask.task_id + '"]')
      .getByRole('link', { name: '准备已审核接待资料' })
      .getAttribute('href'),
    '/knowledge.html',
  );
  const serviceCard = p.locator('[data-task="' + serviceTask.task_id + '"]');
  assert.match(
    await serviceCard.getByRole('link', { name: '查看合作服务' }).getAttribute('href'),
    /partners.html/,
  );
  const date = new Date(Date.now() + 7 * 86400000).toISOString(),
    local = await p.evaluate((iso) => {
      const d = new Date(iso);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }, date);
  await serviceCard.locator('input[type=datetime-local]').fill(local);
  await serviceCard.getByRole('checkbox', { name: '已按本校当前日历核对这一实际日期' }).check();
  await serviceCard.locator('input[type=text]').fill('隔离测试的虚构时刻，不是本校日历或活动批准');
  await serviceCard.getByRole('button', { name: '保存分工与日期' }).click();
  await idle(p);
  await serviceCard
    .getByRole('checkbox', { name: '我确认用已保存的日期、地点范围与负责人建立活动草稿' })
    .check();
  await serviceCard.getByRole('button', { name: '另行创建活动草稿' }).click();
  await idle(p);
  const created = ok(
    await api(
      owner,
      base + '/tasks?packageId=' + book.packageId + '&academicYear=' + new Date().getFullYear(),
    ),
  ).tasks.find((t) => t.task_id === serviceTask.task_id);
  assert(created.activity_id);
  const draft = (
    await pool.query(
      'SELECT status,org_id,title FROM hd_activities WHERE school_id=$1 AND activity_id=$2',
      ['north', created.activity_id],
    )
  ).rows[0];
  assert.equal(draft.status, 'draft');
  assert.equal(draft.org_id, org);
  assert.equal(draft.title, serviceTask.snapshot.title);
  assert.equal(await count('hd_activities'), activitiesBefore + 1);
  assert.equal(await count('hd_contributions'), scoresBefore);
  await filter(p, { channel: 'public' });
  const publicBook = book.entries.filter(
    (e) => e.cohortIds.includes('freshman') && e.month === 8 && e.channel === 'public',
  );
  assert.equal(await p.locator('#entries article').count(), publicBook.length);
  assert((await p.locator('#entries').textContent()).includes(publicBook[0].description));
  checks.push(
    'full XLSX conversion uploaded through browser file input, preview/import/activate, backend exact readback; cross-page selections create only work, Base-1/Base-4 links work and a separately confirmed QA date creates one scoped draft without contributions',
  );
  await p.locator('#version').selectOption(calendar.packageId + ':' + calendar.version);
  await p.locator('#confirm-activate').check();
  await p.locator('#activate').click();
  await idle(p);
  await choose(p, calendar.packageId);
  const seen = new Set();
  let pages = 0;
  for (;;) {
    const ids = await p
      .locator('#entries article')
      .evaluateAll((xs) => xs.map((x) => x.dataset.entry));
    assert(ids.length <= 24);
    ids.forEach((id) => {
      assert(!seen.has(id));
      seen.add(id);
    });
    pages++;
    if (await p.locator('#next-page').isDisabled()) break;
    await p.locator('#next-page').click();
  }
  assert.equal(seen.size, 432);
  assert.deepEqual(seen, new Set(calendar.entries.map((e) => e.entryId)));
  assert.equal(pages, 18);
  await p.locator('#assumptions summary').click();
  assert((await p.locator('#assumptions').textContent()).includes('一年制硕士'));
  assert((await p.locator('#assumptions').textContent()).includes('资金或时间有限'));
  const all = ok(await api(alice, base + '/catalog?packageId=' + calendar.packageId));
  for (const k of ['entries', 'cohorts', 'references', 'assumptions'])
    assert.deepEqual(all[k], calendar[k]);
  checks.push(
    'all 432 calendar entries round-trip unchanged and are reachable across 18 bounded browser pages; all nine cohorts, 20 references and six variant notes preserved',
  );
  await admin.context.close();
  const student = await pageFor('alice'),
    s = student.page;
  await choose(s, calendar.packageId);
  assert(await s.locator('#management').isHidden());
  await filter(s, { category: 'objective' });
  const objective = calendar.entries.find(
      (e) => e.cohortIds.includes('freshman') && e.month === 8 && e.category === 'objective',
    ),
    card = s.locator('[data-entry="' + objective.entryId + '"]');
  assert.equal(await s.locator('#entries article').count(), 1);
  await card.locator('summary').click();
  assert((await card.textContent()).includes(objective.studentNeed));
  assert((await card.textContent()).includes(objective.familyNeed));
  assert(await card.locator('select').isDisabled());
  await filter(s, { category: 'academic' });
  const academic = calendar.entries.find(
      (e) => e.cohortIds.includes('freshman') && e.month === 8 && e.category === 'academic',
    ),
    choice = s.locator('[data-entry="' + academic.entryId + '"]');
  await choice.locator('summary').click();
  assert((await choice.textContent()).includes(academic.studentNeed));
  assert((await choice.textContent()).includes(academic.applicability));
  assert.equal(await choice.locator('select').inputValue(), '');
  await choice.locator('select').selectOption('B');
  await choice.getByRole('checkbox').check();
  await choice.getByRole('button', { name: '加入我的计划' }).click();
  await idle(s);
  await s.reload();
  await idle(s);
  await s.locator('#scope').selectOption(org);
  await idle(s);
  await choose(s, calendar.packageId);
  const own = s.locator('#mine article').filter({ hasText: academic.title });
  await own.waitFor();
  assert.match(await own.textContent(), /B/);
  await own.getByRole('button', { name: '已完成，解除评级' }).click();
  await idle(s);
  assert.match(await own.textContent(), /已完成.*不评级/);
  assert.equal(ok(await api(owner, base + '/mine')).items.length, 0);
  assert.equal((await api(owner, base + '/mine?userId=' + alice.userId)).status, 403);
  assert.equal(await count('hd_contributions'), scoresBefore);
  await s.setViewportSize({ width: 390, height: 844 });
  assert(await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await s.locator('#mine').screenshot({ path: join(qa, 'actual-material-personal-mobile.png') });
  checks.push(
    'ordinary member filters real calendar, sees student and optional family needs and rating conditions; objective rating disabled, priority is voluntary, reload recovers choice, completion clears rating and administrators cannot read it',
  );
  assert.deepEqual(errors, []);
  const report = {
    status: 'PASS',
    fixtureOnly: true,
    usesBothFullSuppliedMaterials: true,
    counts: {
      channelRecords: book.entries.length,
      calendarRecords: calendar.entries.length,
      cohorts: calendar.cohorts.length,
      references: calendar.references.length,
      contextNotes: calendar.assumptions.length,
      pages,
    },
    checks,
    errors,
    htmlExecuted: false,
    actualSchoolPublication: false,
    contributionSideEffects: 0,
    scope:
      'Private documents tested on a loopback fictitious organization; no actual school activation, student trial or external merchant transaction.',
  };
  await writeFile(join(qa, 'full-materials-tests.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    join(qa, 'fixture.json'),
    JSON.stringify({ fixtureOnly: true, orgId: org, origin: config.origin }, null, 2) + '\n',
  );
  console.log(
    'PASS full supplied-material backend and browser flow: 82 + 432 records, 18 pages, needs/context, scoped assignments and private persistence',
  );
} finally {
  await browser?.close();
  await pool.end();
}
