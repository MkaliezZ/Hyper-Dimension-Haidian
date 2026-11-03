import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Isolated fixture and owned browser required');
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  checks = [],
  errors = [],
  started = Date.now(),
  run = randomUUID().slice(0, 8),
  title = '校园迎新志愿 ' + run,
  base = '/activities/schools/north';
await mkdir('qa/activities', { recursive: true });
let activityId, sharedRegistration;
async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((u) => u.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/activities.html');
  await page.waitForFunction(() => window.activitiesQA?.ready);
  if ((await page.locator('#school').inputValue()) !== 'north') {
    await page.locator('#school').selectOption('north');
    await page.waitForFunction(() => activitiesQA.school === 'north' && activitiesQA.ready);
  }
  return page;
}
async function read(page, path) {
  return page.evaluate(async (path) => {
    const r = await fetch(path);
    return { status: r.status, data: await r.json() };
  }, path);
}
const idle = (page) => page.waitForFunction(() => !document.getElementById('school').disabled);
async function success(page, s) {
  await page.locator('#status').filter({ hasText: s }).waitFor();
  assert.equal(await page.locator('#status').evaluate((n) => n.classList.contains('error')), false);
  await idle(page);
}
async function decision(page, reason) {
  await page.locator('#decision-reason').fill(reason);
  await page.locator('#decision-submit').click();
  await page.locator('#decision-dialog').waitFor({ state: 'hidden' });
  await idle(page);
}
async function open(page, manage = false) {
  await page.locator(manage ? '#tab-manage' : '#tab-explore').click();
  await idle(page);
  await page
    .locator(
      (manage ? '#managed' : '#activities') + ' [data-activity-id="' + activityId + '"] button',
    )
    .click();
  await idle(page);
  await page.locator('#detail-title').filter({ hasText: title }).waitFor();
}
async function test(name, fn) {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
try {
  const owner = await account('moda'),
    alice = await account('alice'),
    shared = await account('shared');
  const ownerId = (await read(owner, '/m0/me')).data.userId;
  await test('organizer authors task/time/capacity/verifier draft, submits and reviews publication', async () => {
    await owner.locator('#tab-manage').click();
    await idle(owner);
    await owner.locator('#new-activity').click();
    await owner.locator('#edit-dialog').waitFor({ state: 'visible' });
    await owner.locator('#edit-kind').selectOption('volunteer');
    await owner.locator('#edit-title').fill(title);
    await owner
      .locator('#edit-description')
      .fill('虚构迎新志愿活动，用于自动化检查参与流程，不是实际学校服务。');
    await owner
      .locator('#edit-conditions')
      .fill('在校成员自愿参加，完成分工后提交凭据给指定核验者。');
    const times = await owner.evaluate(() => {
      const local = (d) =>
        new Date(d - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      return {
        start: local(Date.now() - 120000),
        end: local(Date.now() + 3600000),
        close: local(Date.now() + 1800000),
      };
    });
    await owner.locator('#edit-start').fill(times.start);
    await owner.locator('#edit-end').fill(times.end);
    await owner.locator('#edit-close').fill(times.close);
    await owner.locator('#edit-capacity').fill('1');
    await owner.locator('#edit-remind').fill('0');
    await owner.locator('#edit-tasks').fill('校园引导 | 为新同学说明校园设施与路线');
    await owner.locator('#verifier-options input[value="' + ownerId + '"]').check();
    await owner.locator('#save-draft').click();
    await success(owner, '草稿已保存');
    activityId = (await read(owner, base + '/items')).data.items.find(
      (a) => a.title === title,
    ).activityId;
    await owner.getByRole('button', { name: '提交学校审核', exact: true }).click();
    await success(owner, '草稿已提交审核');
    await owner.getByRole('button', { name: '审核发布', exact: true }).click();
    await decision(owner, '已核对虚构活动条件、容量及负责人');
    await success(owner, '活动审核结果已记录');
    assert.equal((await read(alice, base + '/items/' + activityId)).status, 200);
  });
  await test('member registration, waitlist, withdrawal and FIFO promotion use current server states', async () => {
    await open(alice);
    await alice.locator('#join').click();
    await success(alice, '报名成功');
    await open(shared);
    await shared.locator('#join').click();
    await success(shared, '已进入候补');
    assert.equal(
      (await read(shared, base + '/items/' + activityId)).data.registration.status,
      'waitlisted',
    );
    await alice
      .locator('#own-participation')
      .getByRole('button', { name: '退出报名', exact: true })
      .click();
    await decision(alice, '虚构时间冲突，给下一位参与者让出名额');
    await success(alice, '已退出报名');
    await open(shared);
    sharedRegistration = (await read(shared, base + '/items/' + activityId)).data.registration;
    assert.equal(sharedRegistration.status, 'registered');
    await shared.screenshot({ path: 'qa/activities/activity-detail.png', fullPage: true });
  });
  await test('private controlled attachment upload, designated verifier inspection, approval and source-preserving revocation', async () => {
    await shared
      .locator('#own-participation')
      .getByRole('button', { name: '补充参与证明', exact: true })
      .click();
    await shared
      .locator('#evidence-note')
      .fill('虚构参与者完成一次校园设施说明，附带仅用于自动验证的文字凭据。');
    await shared.locator('#evidence-files').setInputFiles({
      name: 'fictitious-evidence.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'Fictitious automated volunteer evidence. This is not actual attendance or service.',
        'utf8',
      ),
    });
    await shared.locator('#evidence-form button.primary').click();
    await success(shared, '证明已提交');
    let detail = (await read(shared, base + '/items/' + activityId)).data;
    sharedRegistration = detail.registration;
    assert.equal(sharedRegistration.status, 'registered');
    const attachment = sharedRegistration.submissions[0].attachments[0];
    assert.ok(attachment.sha256);
    assert.equal(
      (await read(alice, '/attachments/schools/north/' + attachment.attachmentId)).status,
      403,
    );
    assert.equal(
      (await read(owner, '/attachments/schools/north/' + attachment.attachmentId)).status,
      200,
    );
    await open(owner, true);
    const row = owner.locator(
      '#participants [data-registration-id="' + sharedRegistration.registrationId + '"]',
    );
    await row.locator('a').filter({ hasText: '下载凭据' }).waitFor();
    await row.getByRole('button', { name: '确认参与', exact: true }).click();
    await owner.locator('#decision-minutes').fill('1');
    await decision(owner, '已核对虚构服务说明及受控凭据，确认参与');
    await success(owner, '核验决定已记录');
    await row.locator('[data-state="verified"]').waitFor();
    await owner.screenshot({ path: 'qa/activities/verification-workspace.png', fullPage: true });
    await shared.locator('#tab-mine').click();
    await idle(shared);
    const my = shared.locator(
      '#my-records [data-registration-id="' + sharedRegistration.registrationId + '"]',
    );
    await my.locator('[data-state="verified"]').waitFor();
    await shared.screenshot({ path: 'qa/activities/my-service-record.png', fullPage: true });
    await row.getByRole('button', { name: '撤销核验', exact: true }).click();
    await decision(owner, '发现本次虚构证明存在修正项，保留历史并撤销');
    await success(owner, '核验已撤销');
    detail = (await read(shared, base + '/items/' + activityId)).data;
    assert.equal(detail.registration.status, 'revoked');
    assert.equal(detail.registration.submissions.length, 1);
    assert.ok(detail.registration.verificationEventId);
  });
  await test('published recap, cancellation visibility for original participants and mobile layout', async () => {
    await owner.getByRole('button', { name: '发布活动回顾', exact: true }).click();
    await decision(
      owner,
      '本次虚构活动已验证报名、候补、凭据与核验流程，仍需真实负责人检查后用于实际校园。',
    );
    await success(owner, '活动回顾已更新');
    await shared.setViewportSize({ width: 390, height: 844 });
    await open(shared);
    assert.ok(await shared.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shared.screenshot({ path: 'qa/activities/mobile.png', fullPage: true });
    await owner.getByRole('button', { name: '取消活动', exact: true }).click();
    await decision(owner, '本次虚构演示结束，停止新增报名并保留历史');
    await success(owner, '活动已取消');
    assert.equal((await read(shared, base + '/items/' + activityId)).data.status, 'cancelled');
    assert.deepEqual(errors, []);
  });
  await writeFile(
    'qa/activities/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        errors,
        durationMs: Date.now() - started,
        scope:
          'Owned automated Chrome, three independent contexts on one Windows host, fictitious accounts and content. Not human campus acceptance or actual volunteer service.',
      },
      null,
      2,
    ),
  );
} catch (e) {
  for (const [i, c] of browser.contexts().entries()) {
    const p = c.pages()[0];
    if (p && !p.isClosed())
      await p
        .screenshot({ path: 'qa/activities/failure-' + i + '.png', fullPage: true })
        .catch(() => {});
  }
  await writeFile(
    'qa/activities/browser.json',
    JSON.stringify({ status: 'FAIL', checks, error: e.message, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
