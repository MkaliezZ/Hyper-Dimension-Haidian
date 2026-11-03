import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config } from './m1-helpers.mjs';
if (!process.env.HD_QA_CHROME || process.env.HD_M1_TEST_FIXTURE !== '1' || !config.campusEnabled)
  throw Error('Owned QA browser and isolated campus required');
const fixture = JSON.parse(await readFile('.local/contacts-browser-fixture.json', 'utf8'));
const { run, org } = fixture,
  checks = [],
  errors = [],
  started = Date.now();
const [a, b] = fixture.users;
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true });
await mkdir('qa/campus', { recursive: true });
const check = async (name, fn) => {
  await fn();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const watch = (page) => {
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
};
async function login(u) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    page = watch(await context.newPage());
  await page.goto(config.origin + '/auth/login');
  await page.locator('#username').fill(u.username);
  await page.locator('#password').fill(u.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(config.origin + '/m1.html');
  return { context, page };
}
async function contacts(page) {
  await page.goto(config.origin + '/contacts.html');
  await page.locator('#org option[value="' + org + '"]').waitFor({ state: 'attached' });
  await page.locator('#org').selectOption(org);
  await page.waitForFunction(
    (org) => document.getElementById('directory').dataset.scope === org,
    org,
  );
  await page.locator('#directory article').first().waitFor();
}
async function social(page, peer) {
  await page.goto(config.origin + '/social.html');
  await page.locator('#org option[value="' + org + '"]').waitFor({ state: 'attached' });
  await page.locator('#org').selectOption(org);
  await page
    .locator('#contacts')
    .getByRole('button', { name: '私信 ' + peer.username, exact: true })
    .click();
  await page.locator('#connection').filter({ hasText: '已连接' }).waitFor();
}
let ap, bp;
try {
  const aa = await login(a),
    bb = await login(b);
  ap = aa.page;
  bp = bb.page;
  await check(
    'browser explicit request and recipient acceptance before private conversation',
    async () => {
      await Promise.all([contacts(ap), contacts(bp)]);
      await ap
        .locator('#directory article')
        .filter({ hasText: b.username })
        .getByRole('button', { name: '申请联系' })
        .click();
      await ap.locator('#status').filter({ hasText: '已发出联系申请' }).waitFor();
      await bp.locator('#refresh').click();
      await bp
        .locator('#requests article')
        .filter({ hasText: a.username })
        .getByRole('button', { name: '接受联系' })
        .click();
      await bp
        .locator('#requests article')
        .filter({ hasText: a.username })
        .filter({ hasText: '已授权' })
        .waitFor();
      await ap.locator('#refresh').click();
      await ap.locator('#requests article').filter({ hasText: '已授权' }).waitFor();
      await ap.screenshot({ path: 'qa/campus/contacts-authorized.png', fullPage: true });
    },
  );
  await check(
    'browser message roundtrip, reload recovery, in-place revoke readonly and own retraction',
    async () => {
      await Promise.all([social(ap, b), social(bp, a)]);
      const text = '授权后私信自动化验收 ' + run;
      await ap.locator('#text').fill(text);
      await ap.locator('#send button').click();
      await bp.locator('#messages p').filter({ hasText: text }).waitFor();
      await bp.reload();
      await bp.locator('#org option[value="' + org + '"]').waitFor({ state: 'attached' });
      await bp.locator('#org').selectOption(org);
      await bp
        .locator('#contacts')
        .getByRole('button', { name: '私信 ' + a.username, exact: true })
        .click();
      await bp.locator('#messages p').filter({ hasText: text }).waitFor();
      const settings = watch(await bb.context.newPage());
      await contacts(settings);
      await settings
        .locator('#requests article')
        .filter({ hasText: a.username })
        .getByRole('button', { name: '撤销授权' })
        .click();
      await settings.locator('#requests article').filter({ hasText: '已撤销' }).waitFor();
      await ap.locator('#connection').filter({ hasText: '私信只读' }).waitFor();
      await bp.locator('#connection').filter({ hasText: '私信只读' }).waitFor();
      assert.equal(await ap.locator('#send button').isDisabled(), true);
      assert.equal(await bp.locator('#send button').isDisabled(), true);
      assert.equal(
        await ap.locator('#messages').getByRole('button', { name: '修改', exact: true }).count(),
        0,
      );
      await ap.screenshot({ path: 'qa/campus/contacts-readonly.png', fullPage: true });
      await ap
        .locator('#messages article')
        .filter({ hasText: text })
        .getByRole('button', { name: '撤回' })
        .click();
      await bp.locator('#messages p').filter({ hasText: '消息已撤回' }).waitFor();
      await settings.locator('#messages').uncheck();
      await settings.locator('#preferences button').click();
      await settings.locator('#status').filter({ hasText: '偏好已保存' }).waitFor();
      await settings.reload();
      await settings.locator('#directory article').first().waitFor();
      assert.equal(await settings.locator('#messages').isChecked(), false);
      await settings.locator('#messages').check();
      await settings.locator('#preferences button').click();
      await settings.locator('#status').filter({ hasText: '偏好已保存' }).waitFor();
      await settings.locator('#org').selectOption(org);
      await settings.locator('#requests article').filter({ hasText: '已撤销' }).waitFor();
      await settings.close();
    },
  );
  await check('mobile contact settings fit viewport; no browser exceptions', async () => {
    await ap.setViewportSize({ width: 390, height: 844 });
    await contacts(ap);
    assert.equal(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await ap.screenshot({ path: 'qa/campus/contacts-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  });
  await writeFile(
    'qa/campus/contacts-browser.json',
    JSON.stringify(
      {
        status: 'PASS',
        run,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        checks,
        scope:
          'Two clean automated browser contexts on one host, real isolated OIDC/PG/Nakama. Not human or physical multi-device acceptance.',
        org,
      },
      null,
      2,
    ),
  );
} catch (e) {
  if (ap)
    await ap.screenshot({ path: 'qa/campus/contacts-error-a.png', fullPage: true }).catch(() => {});
  if (bp)
    await bp.screenshot({ path: 'qa/campus/contacts-error-b.png', fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
