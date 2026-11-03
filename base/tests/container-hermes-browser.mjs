// External browser against the actual Ubuntu full stack. No user browser or injected model.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { config, fixtures } from './m1-helpers.mjs';
if (
  process.env.HD_M1_TEST_FIXTURE !== '1' ||
  !new URL(config.databaseUrl).pathname.includes('hdnetworkzip')
)
  throw Error('Dedicated new ZIP/container namespace required');
const out = process.env.HD_CONTAINER_EVIDENCE;
if (!out || !process.env.HD_QA_CHROME) throw Error('Private QA output and owned browser required');
await mkdir(out, { recursive: true });
await mkdir(out + '/private', { recursive: true });
const resumed = process.argv.includes('--after-restart'),
  errors = [],
  checks = [];
let browser;
const record = (name) => {
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
async function account(name, storageState) {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 950 },
    acceptDownloads: true,
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  if (!storageState) {
    await page.goto(config.origin + '/auth/login');
    await page.locator('#username').fill(name);
    await page
      .locator('#password')
      .fill(fixtures.find((u) => u.username === name).credentials[0].value);
    await page.locator('#kc-login').click();
    await page.waitForURL(config.origin + '/m1.html');
  }
  await page.goto(config.origin + '/?space=north');
  await page.locator('#reception-retention').filter({ hasText: '天' }).waitFor();
  return { context, page };
}
async function request(c, path, body) {
  const r = await c.request.fetch(
    config.origin + path,
    body ? { method: 'POST', data: body, headers: { Origin: config.origin } } : {},
  );
  return { status: r.status(), data: await r.json() };
}
const denied = (r) =>
  assert([400, 401, 403, 404, 409, 410].includes(r.status) || r.data.error, JSON.stringify(r));
const sessionPath = (id, suffix = '') =>
  '/api/spaces/north/reception-sessions/' + encodeURIComponent(id) + suffix;
async function ask(p, message) {
  await p.locator('#message').fill(message);
  const pending = p.waitForResponse(
    (r) => r.url().endsWith('/reception') && r.request().method() === 'POST',
    { timeout: 65000 },
  );
  await p.locator('#send').click();
  const response = await pending;
  assert.equal(response.status(), 200, await response.text());
  const data = await response.json();
  assert(!data.error, JSON.stringify(data.error));
  const task = data.result.task;
  assert.equal(task.status.state, 'TASK_STATE_COMPLETED', JSON.stringify(task.status));
  const answer = JSON.parse(task.artifacts[0].parts[0].text);
  assert.equal(answer.provider, 'hermes');
  assert.equal(answer.mode, 'live-model');
  await p
    .locator('#reception-session option[value="' + task.contextId + '"]')
    .waitFor({ state: 'attached' });
  await p.waitForFunction(
    (id) => document.querySelector('#reception-session').value === id,
    task.contextId,
  );
  return { task, answer, messageId: response.request().postDataJSON().messageId };
}
async function fresh(p) {
  await p.locator('#reception-new').click();
  await p.waitForFunction(() => !document.querySelector('#reception-session').value);
}
try {
  browser = await chromium.launch({
    executablePath: process.env.HD_QA_CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  if (!resumed) {
    const a = await account('alice'),
      b = await account('shared');
    await fresh(a.page);
    await fresh(b.page);
    const marker = 'UBUNTU-' + randomUUID();
    const first = await ask(
      a.page,
      `请在当前会话记住测试口令 ${marker}。12张卡片平均分给3人，每人多少？请回复完整口令与结果。`,
    );
    assert(first.answer.text.includes(marker));
    assert.match(first.answer.text, /4|四/);
    record('Browser Keycloak login, server-rendered space and actual container Hermes answer');
    denied(await request(b.context, sessionPath(first.task.contextId, '/export')));
    denied(
      await request(b.context, sessionPath(first.task.contextId, '/delete'), {
        requestId: randomUUID(),
        expectedRevision: 1,
      }),
    );
    denied(
      await request(b.context, '/api/spaces/north/reception', {
        messageId: randomUUID(),
        contextId: first.task.contextId,
        message: '复述口令',
      }),
    );
    denied(await request(a.context, '/api/spaces/south/reception-sessions'));
    record('Current OIDC identities enforce cross-person export/delete/context and school access');
    const [follow, other] = await Promise.all([
      ask(a.page, '复述刚才的完整口令；每人再加2张后，每人多少？'),
      ask(b.page, '本会话里我之前提供的测试口令是什么？本会话未提供就说明不知道。'),
    ]);
    assert(follow.answer.text.includes(marker));
    assert.match(follow.answer.text, /6|六/);
    assert(!other.answer.text.includes(marker));
    record('Two concurrent real requests complete with owner-scoped model history');
    await a.page.reload();
    await a.page
      .locator('#reception-session option[value="' + first.task.contextId + '"]')
      .waitFor({ state: 'attached' });
    assert((await a.page.locator('#conversation').innerText()).includes(marker));
    await a.context.storageState({ path: out + '/private/alice-storage.json' });
    await b.context.storageState({ path: out + '/private/shared-storage.json' });
    await writeFile(
      out + '/private/case.json',
      JSON.stringify({
        marker,
        contextId: first.task.contextId,
        messageId: first.messageId,
        firstQuestion: first.task.history[0].parts[0].text,
      }),
    );
    await a.page.screenshot({ path: out + '/container-hermes-initial.png', fullPage: true });
    record('Refresh restores persisted conversation before actual container restart');
  } else {
    const fixture = JSON.parse(await readFile(out + '/private/case.json', 'utf8'));
    const a = await account('alice', out + '/private/alice-storage.json');
    await a.page
      .locator('#reception-session option[value="' + fixture.contextId + '"]')
      .waitFor({ state: 'attached' });
    assert((await a.page.locator('#conversation').innerText()).includes(fixture.marker));
    const recall = await ask(a.page, '请复述当前会话里我提供的完整测试口令。');
    assert(recall.answer.text.includes(fixture.marker));
    record(
      'Actual Base container restart preserves OIDC session, PostgreSQL transcript and real Hermes follow-up',
    );
    const dl = a.page.waitForEvent('download');
    await a.page.locator('#reception-export').click();
    await (await dl).saveAs(out + '/private/owner-export.json');
    const exported = JSON.parse(await readFile(out + '/private/owner-export.json', 'utf8'));
    assert.equal(exported.turns.length, 3);
    assert(JSON.stringify(exported).includes(fixture.marker));
    await a.page.locator('#reception-delete').click();
    await a.page.waitForFunction(
      (id) =>
        ![...document.querySelector('#reception-session').options].some((o) => o.value === id),
      fixture.contextId,
    );
    denied(await request(a.context, sessionPath(fixture.contextId, '/export')));
    denied(
      await request(a.context, '/api/spaces/north/reception', {
        messageId: fixture.messageId,
        message: fixture.firstQuestion,
      }),
    );
    denied(
      await request(a.context, '/api/spaces/north/reception', {
        messageId: randomUUID(),
        contextId: fixture.contextId,
        message: '恢复删除的会话',
      }),
    );
    await a.page.reload();
    await a.page.locator('#reception-retention').filter({ hasText: '天' }).waitFor();
    assert(!(await a.page.locator('#conversation').innerText()).includes(fixture.marker));
    await fresh(a.page);
    const gone = await ask(
      a.page,
      '已经删除的会话里我的完整测试口令是什么？本会话没有就回答不知道。',
    );
    assert(!gone.answer.text.includes(fixture.marker));
    record(
      'Browser JSON export, deletion, cached message replay rejection and fresh model conversation',
    );
    await fresh(a.page);
    const sourced = await ask(a.page, '共享工作室在什么楼层？只用当前空间已发布资料。');
    assert.equal(sourced.answer.basis, 'published');
    assert(sourced.answer.sources.some((s) => s.entityId));
    const unknown = await ask(a.page, '这所学校现任校长的姓名和办公室电话是什么？没有资料不要猜。');
    assert.equal(unknown.answer.basis, 'unavailable');
    record(
      'Current published room citations and unknown school facts remain separated from general conversation',
    );
    await fresh(a.page);
    const backupMarker = 'BACKUP-' + randomUUID();
    const backup = await ask(
      a.page,
      `请在当前会话记住备份测试口令 ${backupMarker}，并复述完整口令。`,
    );
    assert(backup.answer.text.includes(backupMarker));
    const own = await request(a.context, sessionPath(backup.task.contextId, '/export'));
    assert.equal(own.status, 200);
    await writeFile(
      out + '/private/backup-session.json',
      JSON.stringify({
        contextId: backup.task.contextId,
        marker: backupMarker,
        exported: own.data,
      }),
    );
    await writeFile(out + '/private/deleted-case.json', JSON.stringify(fixture));
    await a.page.screenshot({ path: out + '/container-hermes-restored.png', fullPage: true });
    record(
      'A new active real model session is retained solely for isolated seven-database backup/restore verification',
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    out + (resumed ? '/browser-after-restart.json' : '/browser-before-restart.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: 'PASS',
        checks,
        errors,
        provider: 'real local Hermes in Ubuntu container with online DeepSeek',
        identity: 'actual Keycloak browser login and application HttpOnly session',
        realModelCalls: resumed ? 5 : 3,
        limitations: [
          'One-host browser automation, not physical multi-device or actual school acceptance',
        ],
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser?.close();
}
