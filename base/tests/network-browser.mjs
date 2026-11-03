import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { config, login, api } from './m1-helpers.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.includes('hdnetwork')
)
  throw Error('Dedicated fictitious namespace only');
const out = process.env.HD_NETWORK_EVIDENCE || '.local/network-check-20261024';
await mkdir(out, { recursive: true });
const users = await Promise.all(['moda', 'alice', 'shared'].map(login)),
  records = [],
  errors = [];
let browser;
const run = randomUUID().slice(0, 8),
  name = '浏览器校友 ' + run;
const check = async (label, fn) => {
  await fn();
  records.push({ name: label, status: 'PASS' });
  console.log('PASS ' + label);
};
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
try {
  browser = await chromium.launch({
    executablePath: process.env.HD_BROWSER_PATH,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const contexts = await Promise.all(
    users.map((u) =>
      browser.newContext({
        viewport: { width: 1365, height: 950 },
        extraHTTPHeaders: { Authorization: 'Bearer ' + u.token },
        acceptDownloads: true,
      }),
    ),
  );
  const [admin, mentor, student] = await Promise.all(contexts.map((c) => c.newPage()));
  for (const p of [admin, mentor, student]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) =>
      d.type() === 'prompt'
        ? d.accept(
            d.message().includes('希望获得什么支持')
              ? 'PRIVATE_BROWSER_QUESTION_' + run + '，需要帮助了解学校与职业选择。'
              : '浏览器验收操作原因',
          )
        : d.accept(),
    );
  }
  const open = async (p) => {
    await p.goto(config.origin + '/network.html?school=north');
    await p.locator('#status').filter({ hasText: '已按当前学校' }).waitFor();
  };
  await Promise.all([open(admin), open(mentor), open(student)]);
  await check(
    'Browser: opt-in profile submit, administrative review, directory and responsive layout',
    async () => {
      const details = student.locator('details').filter({ has: student.locator('#profile') });
      await details.locator('summary').click();
      await student.locator('#profile-name').fill(name);
      await student.locator('#profile-kind').selectOption('alumni');
      await student
        .locator('#profile-bio')
        .fill('这是浏览器自愿提交的校友名片，用于独立的隔离测试，不代表真实校友身份。');
      await student.locator('#profile-tags').fill('交流,迎新');
      await student.locator('#profile-consent').check();
      await student
        .locator('#profile button[type=submit], #profile button:not([type])')
        .first()
        .click();
      await student.locator('#profile-state').filter({ hasText: '待审核' }).waitFor();
      await admin.locator('#load-admin').click();
      const row = admin.locator('#profile-review article').filter({ hasText: name });
      await Promise.all([
        admin.waitForResponse((r) => r.url().endsWith('/profile-action') && r.status() === 200),
        row.getByRole('button', { name: '审核发布', exact: true }).click(),
      ]);
      await student.locator('#refresh').click();
      await student.locator('#directory article').filter({ hasText: name }).waitFor();
      await student.setViewportSize({ width: 390, height: 844 });
      await student.screenshot({ path: out + '/network-mobile.png', fullPage: true });
      assert(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await student.setViewportSize({ width: 1365, height: 950 });
    },
  );
  await check(
    'Browser: mentor opens a slot; student requests; mentor confirms; administrator sees metadata without private question',
    async () => {
      await mentor
        .locator('details')
        .filter({ has: mentor.locator('#slot') })
        .locator('summary')
        .click();
      const local = (t) => {
        const d = new Date(t);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      };
      const existing = ok(
        await api(users[1], '/network/schools/north/slots?mentor=' + users[1].userId),
      ).items;
      const start = Math.max(
        Date.now() + 10800000,
        ...existing.map((s) => Date.parse(s.ends_at) + 3600000),
      );
      await mentor.locator('#slot-topic').fill('浏览器支持场次 ' + run);
      await mentor.locator('#slot-start').fill(local(start));
      await mentor.locator('#slot-end').fill(local(start + 3600000));
      await mentor.locator('#slot button').click();
      await mentor
        .locator('#slots article')
        .filter({ hasText: '浏览器支持场次 ' + run })
        .waitFor();
      await student.locator('#refresh').click();
      await student
        .locator('#slots article')
        .filter({ hasText: '浏览器支持场次 ' + run })
        .getByRole('button', { name: '申请支持' })
        .click();
      await student
        .locator('#bookings article')
        .filter({ hasText: '浏览器支持场次 ' + run })
        .waitFor();
      const pending = mentor
        .locator('#bookings article')
        .filter({ hasText: '浏览器支持场次 ' + run });
      await mentor.locator('#refresh').click();
      await pending.getByRole('button', { name: '确认', exact: true }).click();
      await pending.filter({ hasText: '已确认' }).waitFor();
      await student.locator('#refresh').click();
      await student
        .locator('#bookings article')
        .filter({ hasText: '浏览器支持场次 ' + run })
        .filter({ hasText: '已确认' })
        .waitFor();
      await admin.locator('#load-admin').click();
      const adminRow = admin
        .locator('#booking-admin article')
        .filter({ hasText: '浏览器支持场次 ' + run });
      await adminRow.waitFor();
      assert(!(await adminRow.innerText()).includes('PRIVATE_BROWSER_QUESTION_'));
      await admin.screenshot({ path: out + '/network-admin.png', fullPage: true });
    },
  );
  await check(
    'Browser: administrator reviews opportunity metadata and the published card opens its native forum body',
    async () => {
      const fixture = JSON.parse(await readFile(out + '/network-live.json', 'utf8')).fixture;
      let post = ok(await api(users[0], '/community/schools/north/post/' + fixture.sourceId));
      if (post.sourceStatus !== 'published') {
        if (!post.appeal || post.appeal.resolved)
          await api(users[1], '/community/schools/north/action', {
            requestId: randomUUID(),
            id: post.id,
            action: 'appeal',
            expectedRevision: post.revision,
            expectedWorkflowVersion: post.workflowVersion,
            reason: '申请恢复隔离测试正文',
          }).then(ok);
        post = ok(await api(users[0], '/community/schools/north/post/' + fixture.sourceId));
        ok(
          await api(users[0], '/community/schools/north/action', {
            requestId: randomUUID(),
            id: post.id,
            action: 'review-appeal',
            decision: 'restore',
            expectedRevision: post.revision,
            expectedWorkflowVersion: post.workflowVersion,
            reason: '管理员审核申诉后恢复测试正文',
          }),
        );
      }
      await admin.locator('#load-admin').click();
      const row = admin
        .locator('#opportunity-admin article')
        .filter({ has: admin.locator('a[href*="' + fixture.sourceId + '"]') });
      await Promise.all([
        admin.waitForResponse(
          (r) => r.url().endsWith('/opportunity-approve') && r.status() === 200,
        ),
        row.getByRole('button', { name: '核对元数据并发布' }).click(),
      ]);
      await student.locator('#refresh').click();
      const card = student
        .locator('#opportunities article')
        .filter({ has: student.locator('a[href*="' + fixture.sourceId + '"]') });
      await card.waitFor();
      assert.equal(
        await card.getByRole('link', { name: '打开外部官方申请入口' }).getAttribute('href'),
        'https://example.com/changed',
      );
      await card.getByRole('link', { name: '查看原生正文、审核及讨论' }).click();
      await student
        .locator('#detail-content')
        .filter({ hasText: '隔离测试的原生论坛正文' })
        .waitFor();
      await open(student);
    },
  );
  await check(
    'Browser: scene room entry opens the same scoped network page; reception export, reload and delete work',
    async () => {
      await mentor.goto(config.origin + '/?space=north');
      await mentor.locator('#loading').waitFor({ state: 'hidden' });
      await mentor.locator('#rooms button').first().click();
      const href = await mentor.locator('#room-network').getAttribute('href');
      assert(href.includes('sceneId=') && href.includes('entityId='));
      await mentor.locator('#room-network').click();
      await mentor.locator('#status').filter({ hasText: '已按当前学校' }).waitFor();
      assert(await mentor.locator('#place-filter').inputValue());
      await mentor.goto(config.origin + '/?space=north');
      await mentor.locator('#loading').waitFor({ state: 'hidden' });
      await mentor.locator('#reception-new').click();
      await mentor.locator('#message').fill('介绍一下建筑和参观路线 ' + run);
      await mentor.locator('#send').click();
      await mentor.locator('#send').waitFor({ state: 'visible' });
      await mentor.waitForFunction(() => !document.getElementById('reception-export').disabled);
      await mentor.reload();
      await mentor.locator('#loading').waitFor({ state: 'hidden' });
      await mentor.locator('#conversation').filter({ hasText: run }).waitFor();
      const download = mentor.waitForEvent('download');
      await mentor.locator('#reception-export').click();
      const d = await download;
      await d.saveAs(out + '/reception-export-fixture.json');
      const exported = JSON.parse(await readFile(out + '/reception-export-fixture.json', 'utf8'));
      assert(exported.turns.some((t) => t.question.includes(run)));
      await mentor.locator('#reception-delete').click();
      await mentor.locator('#conversation').filter({ hasText: '新会话已就绪' }).waitFor();
    },
  );
  await check(
    'Browser: school owner configures retention; ordinary member cannot read policy diagnostics',
    async () => {
      await admin.goto(config.origin + '/reception-admin.html?school=north');
      await admin.locator('#status').filter({ hasText: '未读取对话正文' }).waitFor();
      await admin.locator('#days').fill('14');
      await admin.locator('#reason').fill('浏览器隔离测试更改保留期限');
      await Promise.all([
        admin.waitForResponse((r) => r.url().endsWith('/policy') && r.status() === 200),
        admin.locator('#save').click(),
      ]);
      const d = ok(await api(users[0], '/reception-admin/schools/north/status'));
      assert.equal(d.policy.retentionDays, 14);
      await admin.locator('#days').fill('30');
      await admin.locator('#reason').fill('恢复默认三十天期限');
      await Promise.all([
        admin.waitForResponse((r) => r.url().endsWith('/policy') && r.status() === 200),
        admin.locator('#save').click(),
      ]);
      assert.equal((await api(users[2], '/reception-admin/schools/north/status')).status, 403);
    },
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await writeFile(
    out + '/network-browser.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks: records,
        errors,
        complete: records.length === 5,
        scope:
          'Automated browser contexts on one Windows host against isolated Ubuntu Docker services. No real people or physical multi-device acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
}
