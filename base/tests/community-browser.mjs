import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (process.env.HD_M1_TEST_FIXTURE !== '1' || !process.env.HD_QA_CHROME)
  throw Error('Isolated browser fixture required');
const browser = await chromium.launch({ executablePath: process.env.HD_QA_CHROME, headless: true }),
  errors = [],
  checks = [],
  title = '浏览器校园故事 ' + randomUUID().slice(0, 8);
async function account(name) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await c.newPage(),
    f = fixtures.find((x) => x.username === name);
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(config.origin + '/auth/login');
  await p.locator('#username').fill(name);
  await p.locator('#password').fill(f.credentials[0].value);
  await p.locator('#kc-login').click();
  await p.waitForURL(config.origin + '/m1.html');
  await p.goto(config.origin + '/community.html');
  await p.waitForFunction(() => window.communityQA?.home);
  return { c, p };
}
async function find(p) {
  await p.locator('#query').fill(title);
  await p.locator('#search-form button').click();
  const response = p.waitForResponse((r) =>
    /\/community\/schools\/[^/]+\/post\/[^/]+$/.test(new URL(r.url()).pathname),
  );
  await p.locator('#posts button').filter({ hasText: title }).click();
  const data = await (await response).json();
  await p.waitForFunction(
    ({ id, revision, workflowVersion }) =>
      communityQA.selected?.id === id &&
      communityQA.selected?.revision === revision &&
      communityQA.selected?.workflowVersion === workflowVersion,
    data,
  );
  await p.locator('#detail-title').filter({ hasText: title }).waitFor();
}
try {
  await mkdir('qa/community', { recursive: true });
  const a = await account('alice'),
    o = await account('moda'),
    b = await account('shared');
  await a.p.locator('#title').fill(title);
  await a.p
    .locator('#content')
    .fill('这是三个独立自动化浏览器上下文验证的校园记忆，所有人都是虚构测试账户。');
  await a.p.locator('#place').selectOption({ index: 1 });
  await a.p.locator('#save-draft').click();
  await a.p.locator('#draft-state').filter({ hasText: '草稿已保存' }).waitFor();
  await a.p.locator('#attachment-file').setInputFiles({
    name: 'browser-memory.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('虚构校园附件'),
  });
  await a.p.locator('#attach-form button').click();
  await a.p.locator('#status').filter({ hasText: '附件已绑定' }).waitFor();
  for (;;) {
    const response = await a.c.request.get(config.origin + '/m0/schools/north/forum/posting-state');
    const state = await response.json();
    if (!state.retryAfterMs) break;
    if (state.retryAfterMs > 180000) throw Error('Native cooldown exceeds the fixture policy');
    console.log('Waiting for native posting cooldown: ' + state.retryAfterMs + 'ms');
    await new Promise((r) => setTimeout(r, Math.min(state.retryAfterMs + 50, 30000)));
  }
  await a.p.locator('#submit-draft').click();
  await a.p.locator('#detail-meta').filter({ hasText: '待审核' }).waitFor();
  const sourceId = await a.p.evaluate(() => communityQA.selected.id);
  await b.p.locator('#query').fill(title);
  await b.p.locator('#search-form button').click();
  await b.p.waitForFunction(() =>
    document.querySelector('#posts').textContent.includes('还没有符合条件'),
  );
  assert.equal(await b.p.locator('#posts button').count(), 0);
  await find(o.p);
  await o.p.locator('#reason').fill('已检查虚构校园内容和地点关联');
  await o.p.locator('#detail-actions button').filter({ hasText: '批准发布' }).click();
  await o.p.locator('#detail-meta').filter({ hasText: '已发布' }).waitFor();
  await find(b.p);
  await b.p.locator('#detail-content').filter({ hasText: '三个独立' }).waitFor();
  assert.equal(await b.p.locator('#attachments a').count(), 1);
  const download = await b.c.request.get(
    await b.p
      .locator('#attachments a')
      .getAttribute('href')
      .then((h) => config.origin + h),
  );
  assert.equal(download.status(), 200);
  checks.push({
    name: 'compose private draft, controlled attachment, reviewed publication and peer body access',
    status: 'PASS',
  });
  await b.p.screenshot({ path: 'qa/community/community-member.png', fullPage: true });
  await find(a.p);
  await a.p.locator('#reason').fill('本人撤回这条虚构自动验收故事');
  await a.p.locator('#detail-actions button').filter({ hasText: '撤回我的内容' }).click();
  await a.p.locator('#detail-meta').filter({ hasText: '已撤回' }).waitFor();
  await b.p.locator('#search-form button').click();
  await b.p.waitForFunction(() =>
    document.querySelector('#posts').textContent.includes('还没有符合条件'),
  );
  assert.equal(await b.p.locator('#posts button').count(), 0);
  checks.push({
    name: 'author withdrawal removes the same source from peer discovery',
    status: 'PASS',
  });
  await a.p.setViewportSize({ width: 390, height: 844 });
  assert.equal(await a.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await a.p.screenshot({ path: 'qa/community/community-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  checks.push({
    name: 'responsive layout and independent contexts have no JavaScript errors',
    status: 'PASS',
  });
  await writeFile(
    'qa/community/browser.json',
    JSON.stringify({ status: 'PASS', checks, sourceId, errors }, null, 2),
  );
} finally {
  await browser.close();
}
