import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';

if (!process.env.HD_QA_CHROME || process.env.HD_M1_TEST_FIXTURE !== '1' || !config.partnersEnabled)
  throw Error('Owned QA browser and isolated partners fixture opt-in required');
const output = 'qa/partners',
  run = randomUUID().slice(0, 8),
  start = Date.now();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
const checks = [],
  errors = [],
  base = '/m5/schools/north';
let partnerId, serviceId, offerId, taskId, entitlementId, voucherCode;
const merchantName = '校园书屋 · 浏览器示例 ' + run;
const serviceName = '新生阅读咨询 ' + run;
const offerName = '校园阅读体验券 ' + run;
const question = '预约了解校园阅读活动，虚构自动化示例 ' + run;
async function account(name) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.name + ': ' + e.message));
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(name);
  await page
    .locator('#password')
    .fill(fixtures.find((u) => u.username === name).credentials[0].value);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  await page.goto(config.origin + '/partners.html');
  await page.waitForFunction(() => window.partnersQA?.ready);
  assert.equal(await page.evaluate(() => partnersQA.fixtureOnly), true);
  if ((await page.locator('#school').inputValue()) !== 'north') {
    await page.locator('#school').selectOption('north');
    await page.waitForFunction(() => partnersQA.school === 'north');
  }
  return page;
}
async function read(page, path) {
  return page.evaluate(async (path) => {
    const r = await fetch(path);
    return { status: r.status, data: await r.json() };
  }, path);
}
async function success(page, text) {
  await page.locator('#status').filter({ hasText: text }).waitFor();
  assert.equal(
    await page.locator('#status').evaluate((el) => el.classList.contains('error')),
    false,
  );
}
async function decision(page, reason = '已核对本次虚构验证资料与条款') {
  await page.locator('#decision-reason').fill(reason);
  await page.locator('#decision-submit').click();
  await page.locator('#decision-dialog').waitFor({ state: 'hidden' });
}
async function workspace(page) {
  await page.locator('#tab-manage').click();
  await page.locator('#refresh-manage').click();
  await page.waitForFunction(() => !document.getElementById('school').disabled);
  const row = page
    .locator('#my-partners [data-partner-id]')
    .filter({ has: page.getByRole('heading', { name: merchantName, exact: true }) });
  await row.getByRole('button', { name: '打开工作台' }).click();
  await page.locator('#partner-name').filter({ hasText: merchantName }).waitFor();
  await page.waitForFunction(() => !document.getElementById('school').disabled);
}
async function openDirectory(page) {
  await page.locator('#tab-directory').click();
  await page.locator('#refresh-directory').click();
  await page.locator('#search').fill(serviceName);
  await page.locator('#directory [data-service-id="' + serviceId + '"] button').click();
  await page.locator('#service-title').filter({ hasText: serviceName }).waitFor();
}
async function settle(page, id, state) {
  for (let i = 0; i < 10; i++) {
    await page.locator('#refresh-mine').click();
    const card = page.locator('#my-tasks [data-task-id="' + id + '"]');
    await card.waitFor();
    if (await card.locator('[data-state="' + state + '"]').count()) return;
    const retry = card.getByRole('button', { name: '查询已有办理结果' });
    if (await retry.count()) await retry.click();
    await page.waitForTimeout(250);
  }
  throw Error('Original fixture task did not reach required state: ' + state);
}
async function test(name, fn) {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
try {
  const applicant = await account('alice'),
    owner = await account('moda'),
    redeemer = await account('shared');
  const redeemerId = (await read(redeemer, '/m0/me')).data.userId;
  await test('application, owner review and separately scoped redemption staff', async () => {
    await applicant.locator('#tab-manage').click();
    await applicant.getByText('申请成为学校合作方', { exact: true }).click();
    await applicant.locator('#apply-name').fill(merchantName);
    await applicant.locator('#apply-category').fill('阅读与文化');
    await applicant
      .locator('#apply-description')
      .fill('独立虚构校园书屋，仅用于浏览器自动验证，不产生真实商户交易。');
    await applicant.locator('#application-form button').click();
    await success(applicant, '申请已提交');
    partnerId = (await read(applicant, base + '/partners')).data.partners.find(
      (p) => p.name === merchantName,
    ).partnerId;
    await workspace(owner);
    await owner.getByRole('button', { name: '审核通过入驻', exact: true }).click();
    await decision(owner);
    await success(owner, '入驻审核结果已保存');
    await owner.locator('#staff-user').selectOption(redeemerId);
    await owner.locator('#staff-role').selectOption('redeemer');
    await owner.locator('#staff-active').check();
    await owner.locator('#staff-reason').fill('虚构书屋单独授权核销职责');
    await owner.locator('#staff-form button').click();
    await success(owner, '人员权限已更新');
    await workspace(applicant);
    assert.equal(await applicant.locator('#staff-form').isVisible(), false);
    assert.equal(await applicant.locator('#partner-maintenance').isVisible(), true);
  });
  await test('maintainer service and offer authoring, owner review, current public directory', async () => {
    await applicant.locator('#new-service').click();
    await applicant.locator('#edit-service-title').fill(serviceName);
    await applicant.locator('#edit-service-hours').fill('周一至周五 09:00–17:00');
    await applicant
      .locator('#edit-service-description')
      .fill('校园书屋为本校成员介绍阅读活动，预约仅为本地虚构流程演示。');
    await applicant
      .locator('#edit-service-conditions')
      .fill('本校成员自愿咨询，授权前不会分享填写内容。');
    await applicant.locator('#edit-service-url').fill('https://example.org/campus-reading');
    await applicant.locator('#service-form button.primary').click();
    await success(applicant, '服务资料已提交审核');
    serviceId = (
      await read(applicant, base + '/services?partnerId=' + partnerId)
    ).data.services.find((s) => s.title === serviceName).serviceId;
    assert.equal(
      (await read(applicant, base + '/directory')).data.sources.some(
        (s) => s.serviceId === serviceId,
      ),
      false,
    );
    await applicant.locator('#new-offer').click();
    await applicant.locator('#edit-offer-title').fill(offerName);
    await applicant
      .locator('#edit-offer-terms')
      .fill('一人一份，仅用于校园本地自动验证；不对应真实商品、折扣或金钱价值。');
    await applicant.locator('#edit-offer-stock').fill('20');
    await applicant.locator('#edit-offer-score').fill('0');
    await applicant.locator('#edit-offer-policy').selectOption('honor');
    await applicant.locator('#offer-form button.primary').click();
    await success(applicant, '权益已提交审核');
    offerId = (
      await read(applicant, base + '/offers?partnerId=' + partnerId + '&manage=true')
    ).data.offers.find((o) => o.title === offerName).offerId;
    await workspace(owner);
    await owner
      .locator('#managed-services [data-service-id="' + serviceId + '"]')
      .getByRole('button', { name: '审核发布', exact: true })
      .click();
    await decision(owner);
    await owner
      .locator('#managed-offers [data-offer-id="' + offerId + '"]')
      .getByRole('button', { name: '审核发布', exact: true })
      .click();
    await decision(owner);
    await openDirectory(applicant);
    assert.match(await applicant.locator('#adapter-note').innerText(), /本地虚构/);
    assert.equal(
      await applicant.locator('#official-link').getAttribute('href'),
      'https://example.org/campus-reading',
    );
    await applicant.screenshot({ path: output + '/directory.png', fullPage: true });
  });
  await test('private proposal then exact recipient/field consent, original-task reconciliation and cancellation receipt', async () => {
    await applicant.locator('#new-request').click();
    await applicant.locator('#request-kind').selectOption('appointment');
    await applicant.locator('#request-question').fill(question);
    await applicant
      .locator('#request-time')
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await applicant.locator('#request-name').fill('虚构读者');
    await applicant.locator('#request-contact').fill('fixture-reader@example.invalid');
    await applicant.locator('#request-form button.primary').click();
    await applicant.locator('#consent-dialog').waitFor({ state: 'visible' });
    assert.equal(await applicant.locator('#consent-check').isChecked(), false);
    assert.match(await applicant.locator('#consent-recipient').innerText(), new RegExp(run));
    assert.match(
      await applicant.locator('#consent-fields').innerText(),
      /fixture-reader@example.invalid/,
    );
    const drafts = (await read(applicant, base + '/tasks')).data.tasks.filter(
      (t) => t.request.question === question,
    );
    assert.equal(drafts.length, 1);
    taskId = drafts[0].taskId;
    assert.equal(drafts[0].status, 'proposed');
    assert.equal(
      (await read(owner, base + '/partners/' + partnerId + '/tasks')).data.tasks.some(
        (t) => t.taskId === taskId,
      ),
      false,
    );
    await applicant.locator('#consent-check').check();
    await applicant.locator('#consent-form button.primary').click();
    await success(applicant, '授权已保存');
    await settle(applicant, taskId, 'confirmed');
    let record = (await read(applicant, base + '/tasks/' + taskId)).data;
    assert.equal(record.externalReceipt.provider, 'local-fixture');
    assert.deepEqual([...record.consent.fields].sort(), Object.keys(record.request).sort());
    const task = applicant.locator('#my-tasks [data-task-id="' + taskId + '"]');
    await task.getByRole('button', { name: '取消本次办理' }).click();
    await decision(applicant, '虚构读者取消本次演示预约');
    await settle(applicant, taskId, 'cancelled');
    record = (await read(applicant, base + '/tasks/' + taskId)).data;
    assert.ok(record.cancelReceipt.receiptId);
    assert.equal(
      (await read(applicant, base + '/tasks')).data.tasks.filter(
        (t) => t.request.question === question,
      ).length,
      1,
    );
  });
  await test('terms-confirmed own benefit, private voucher and separately authorized one-time redemption', async () => {
    await openDirectory(applicant);
    await applicant
      .locator('#service-offers [data-offer-id="' + offerId + '"]')
      .getByRole('button')
      .click();
    await applicant.locator('#claim-dialog').waitFor({ state: 'visible' });
    assert.equal(await applicant.locator('#claim-check').isChecked(), false);
    await applicant.locator('#claim-check').check();
    await applicant.locator('#claim-form button.primary').click();
    await success(applicant, '已领取一份权益');
    const entry = (await read(applicant, base + '/entitlements')).data.entitlements.find(
      (e) => e.offerId === offerId,
    );
    entitlementId = entry.entitlementId;
    const ownCard = applicant.locator(
      '#my-entitlements [data-entitlement-id="' + entitlementId + '"]',
    );
    await ownCard.getByRole('button', { name: '出示核销码' }).click();
    voucherCode = await ownCard.locator('.voucher').inputValue();
    assert.ok(voucherCode.startsWith('HDV1.'));
    await ownCard.getByRole('button', { name: '出示核销码' }).click();
    assert.equal(
      (await read(redeemer, base + '/entitlements')).data.entitlements.some(
        (e) => e.entitlementId === entitlementId,
      ),
      false,
    );
    await redeemer.locator('#tab-manage').click();
    await redeemer.locator('#refresh-manage').click();
    await redeemer.locator('#tab-redeem').click();
    await redeemer.waitForFunction(() => !document.getElementById('school').disabled);
    await redeemer.locator('#redeem-partner').selectOption(partnerId);
    await redeemer.locator('#redeem-code').fill(voucherCode);
    await redeemer.locator('#redeem-confirm').check();
    await redeemer.locator('#redeem-form button').click();
    await success(redeemer, '核销已完成');
    assert.match(await redeemer.locator('#redemption-result').innerText(), /已使用一次/);
    await redeemer.locator('#redeem-code').fill(voucherCode);
    await redeemer.locator('#redeem-partner').selectOption(partnerId);
    await redeemer.locator('#redeem-confirm').check();
    await redeemer.locator('#redeem-form button').click();
    await redeemer.locator('#status.error').waitFor();
    await redeemer.locator('#redeem-code').fill('');
    await applicant.locator('#refresh-mine').click();
    await ownCard.locator('[data-state="redeemed"]').waitFor();
    assert.equal(await ownCard.locator('.voucher').count(), 0);
    await applicant.screenshot({ path: output + '/my-records.png', fullPage: true });
  });
  await test('own-partner aggregate metrics and revoked redemption permission without widening scope', async () => {
    await workspace(owner);
    const counts = await owner.locator('#metrics strong').allTextContents();
    assert.ok(counts.every((n) => Number(n) >= 1));
    await owner.screenshot({ path: output + '/partner-workspace.png', fullPage: true });
    await owner.locator('#staff-user').selectOption(redeemerId);
    await owner.locator('#staff-role').selectOption('redeemer');
    await owner.locator('#staff-active').uncheck();
    await owner.locator('#staff-reason').fill('演示完成撤销此次临时核销授权');
    await owner.locator('#staff-form button').click();
    await success(owner, '人员权限已更新');
    await redeemer.locator('#tab-manage').click();
    await redeemer.locator('#refresh-manage').click();
    await redeemer.waitForFunction(() => !document.getElementById('school').disabled);
    assert.equal(
      await redeemer.locator('#redeem-partner option[value="' + partnerId + '"]').count(),
      0,
    );
    assert.equal((await read(redeemer, base + '/partners/' + partnerId + '/metrics')).status, 403);
  });
  await test('mobile layout, school switch and no browser exceptions', async () => {
    await applicant.setViewportSize({ width: 390, height: 844 });
    await openDirectory(applicant);
    assert.ok(
      await applicant.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    );
    await applicant.locator('#new-request').click();
    assert.ok(
      await applicant
        .locator('#request-dialog')
        .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
    );
    await applicant.locator('#request-dialog [data-close]').click();
    await applicant.screenshot({ path: output + '/mobile.png', fullPage: true });
    await redeemer.locator('#school').selectOption('south');
    await redeemer.waitForFunction(() => partnersQA.school === 'south');
    assert.equal(
      (await read(redeemer, '/m5/schools/south/directory')).data.sources.some(
        (s) => s.serviceId === serviceId,
      ),
      false,
    );
    assert.deepEqual(errors, []);
  });
  await writeFile(
    output + '/browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        checks,
        errors,
        durationMs: Date.now() - start,
        scope:
          'Automated owned Chrome; three independent contexts on one Windows host; fictitious school/partner data and local-fixture adapter. Not actual school, physical multi-device, or live merchant acceptance.',
      },
      null,
      2,
    ),
  );
} catch (e) {
  for (const [i, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (!page || page.isClosed()) continue;
    await page
      .evaluate(() => {
        for (const el of document.querySelectorAll(
          '.voucher, #redeem-code, #request-contact, #request-name',
        )) {
          el.value = '';
          el.hidden = true;
        }
        for (const el of document.querySelectorAll('details')) el.open = false;
        for (const el of document.querySelectorAll('#consent-fields')) el.replaceChildren();
      })
      .catch(() => {});
    await page
      .screenshot({ path: output + '/failure-' + i + '.png', fullPage: true })
      .catch(() => {});
  }
  await writeFile(
    output + '/browser.json',
    JSON.stringify(
      {
        status: 'FAIL',
        checks,
        error: e.message,
        errors,
        durationMs: Date.now() - start,
        scope: 'Automated isolated fixture only; no credentials or voucher values included.',
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
}
