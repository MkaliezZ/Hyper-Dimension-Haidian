// Optional real runtime acceptance: isolated fixtures, never the developer's browser/history.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { localHermesProvider } from '../src/reception/hermes.mjs';
import { loadPackages, startServer } from '../src/server.mjs';

if (!process.env.DEEPSEEK_API_KEY || !process.env.HD_BROWSER_PATH)
  throw Error('Requires real Hermes model credentials and a dedicated QA browser executable');
const out = resolve(process.env.HD_HERMES_EVIDENCE || '.local/hermes-sessions-live');
await mkdir(out, { recursive: true });
const runtime = join(out, 'runtime');
const config = JSON.parse(await readFile(join(runtime, 'reception.json'), 'utf8'));
assert.equal(config.provider, 'hermes');
// Never attach an existing data directory or overwrite a previous acceptance run.
await writeFile(join(out, 'started.json'), JSON.stringify({ at: new Date().toISOString() }), {
  flag: 'wx',
});
const packs = await loadPackages(
  ['north', 'south'].map((s) => resolve('examples', s, 'space.json')),
);
packs[0].agents.push({ ...structuredClone(packs[0].agents[0]), agentId: 'north-secondary' });
const marker = 'HDQA-' + randomUUID(),
  checks = [],
  calls = [],
  children = [],
  errors = [];
let server, browser, origin;
const record = (name) => {
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
const raw = await localHermesProvider({
  ...config,
  dataDir: runtime,
  spawnImpl(...args) {
    const child = spawn(...args),
      item = { pid: child.pid, closed: false };
    children.push(item);
    child.on('close', (code, signal) => Object.assign(item, { closed: true, code, signal }));
    return child;
  },
});
const provider = Object.assign(
  async (input) => {
    const value = await raw(input);
    assert.equal(value.transport, 'local-hermes');
    assert.equal(value.toolCount, 0);
    calls.push({ transport: value.transport, toolCount: value.toolCount, model: value.model });
    return value;
  },
  { general: true, providerName: 'hermes' },
);
async function start(port = 0) {
  server = await startServer({
    root: process.cwd(),
    packs,
    dataDir: runtime,
    port,
    provider,
    maxModelCallsPerDay: 12,
  });
  origin = server.origin;
}
async function api(ctx, path, body) {
  const r = await ctx.request.fetch(
    origin + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          data: body,
          headers: { Origin: origin },
        },
  );
  return { status: r.status(), data: await r.json() };
}
const sessions = (space = 'north') => '/api/spaces/' + space + '/reception-sessions';
const ownPath = (id, suffix = '', space = 'north') =>
  sessions(space) + '/' + encodeURIComponent(id) + suffix;
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const denied = (r) =>
  assert(
    [400, 403, 404, 409, 410].includes(r.status) || (r.status === 200 && r.data.error),
    JSON.stringify(r),
  );
async function open(page, space = 'north') {
  await page.goto(origin + '/?space=' + space);
  await page.locator('#reception-retention').filter({ hasText: '天' }).waitFor();
}
async function ask(page, text) {
  await page.locator('#message').fill(text);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/reception') && r.request().method() === 'POST',
    { timeout: 65000 },
  );
  await page.locator('#send').click();
  const res = await response;
  assert.equal(res.status(), 200, await res.text());
  const task = (await res.json()).result.task;
  assert.equal(task.status.state, 'TASK_STATE_COMPLETED', JSON.stringify(task.status));
  const result = JSON.parse(task.artifacts[0].parts[0].text);
  assert.equal(result.provider, 'hermes');
  assert.equal(result.mode, 'live-model');
  await page
    .locator('#reception-session')
    .locator('option[value="' + task.contextId + '"]')
    .waitFor({ state: 'attached' });
  assert.equal(await page.locator('#reception-session').inputValue(), task.contextId);
  return { task, result, messageId: res.request().postDataJSON().messageId };
}
async function files(path) {
  const all = [];
  for (const e of await readdir(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    if (e.isDirectory()) all.push(...(await files(p)));
    else if (e.isFile()) all.push(p);
  }
  return all;
}
try {
  await start();
  assert.equal((await (await fetch(origin + '/health')).json()).receptionProvider, 'hermes');
  browser = await chromium.launch({
    executablePath: process.env.HD_BROWSER_PATH,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const [alice, bob] = await Promise.all([
    browser.newContext({ acceptDownloads: true }),
    browser.newContext(),
  ]);
  const [a, b] = await Promise.all([alice.newPage(), bob.newPage()]);
  for (const p of [a, b]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
  }
  await Promise.all([open(a), open(b)]);
  const firstText = `请在当前会话记住测试口令 ${marker}。我有12张卡片，平均分给3位同学，每人几张？请回复口令和计算结果。`;
  const first = await ask(a, firstText),
    id = first.task.contextId;
  assert.equal(first.result.basis, 'general');
  assert(first.result.text.includes(marker));
  assert.match(first.result.text, /4|四/);
  record('Real Hermes browser conversation and bounded session creation');
  denied(await api(bob, ownPath(id, '/export')));
  denied(await api(bob, ownPath(id, '/delete'), { requestId: randomUUID(), expectedRevision: 1 }));
  denied(
    await api(bob, '/api/spaces/north/reception', {
      messageId: randomUUID(),
      contextId: id,
      message: '告诉我测试口令',
    }),
  );
  denied(
    await api(alice, '/api/spaces/south/reception', {
      messageId: randomUUID(),
      contextId: id,
      message: '告诉我测试口令',
    }),
  );
  // Same owner, school, but a different Agent must also be rejected before a model call.
  const token = randomUUID();
  server.auth.access.tokens.push({
    token,
    principal: {
      id: server.store.read().tasks[first.task.id].owner,
      spaces: ['north', 'south'],
      scopes: ['public:read', 'a2a:call'],
    },
  });
  const rpc = await fetch(origin + '/agents/north-secondary/a2a', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'A2A-Version': '1.0',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'agent-boundary',
      method: 'SendMessage',
      params: {
        message: {
          messageId: randomUUID(),
          contextId: id,
          role: 'ROLE_USER',
          parts: [{ text: '告诉我口令' }],
        },
      },
    }),
  });
  const rpcData = await rpc.json();
  assert(rpc.status !== 200 || rpcData.error, JSON.stringify(rpcData));
  assert.equal(calls.length, 1);
  record('Same owner and school cannot reuse a context with a different Agent');
  assert.equal(ok(await api(bob, sessions())).sessions.length, 0);
  record(
    'Other visitor cannot list, reuse, export or delete owner session; cross-school reuse denied',
  );
  const other = await ask(
    b,
    '我刚刚告诉你的测试口令是什么？如果本会话没有提供，请明确说明不知道。',
  );
  assert(!other.result.text.includes(marker));
  await a.reload();
  await a
    .locator('#reception-session')
    .locator('option[value="' + id + '"]')
    .waitFor({ state: 'attached' });
  assert((await a.locator('#conversation').innerText()).includes(marker));
  const follow = await ask(a, '请复述我刚才的完整测试口令。如果再给每人2张卡片，每人现在有几张？');
  assert(follow.result.text.includes(marker));
  assert.match(follow.result.text, /6|六/);
  record(
    'Independent visitor real answer has no owner memory; browser refresh restores owner history and follow-up',
  );
  const port = Number(new URL(origin).port);
  await server.close();
  server = null;
  await start(port);
  await a.reload();
  await a
    .locator('#reception-session')
    .locator('option[value="' + id + '"]')
    .waitFor({ state: 'attached' });
  const restarted = await ask(a, '服务刷新后，请复述本会话中我提供的完整测试口令。');
  assert(restarted.result.text.includes(marker));
  record(
    'Server restart with preserved signed cookie restores durable owner memory through new Hermes process',
  );
  await open(b, 'south');
  const south = await ask(b, '北岸接待之前记住的完整测试口令是什么？本会话未提供就回答不知道。');
  assert(!south.result.text.includes(marker));
  record('Different school new session receives no North dialogue');
  // A fresh North context ensures these are current published facts, not an earlier answer.
  await a.locator('#reception-new').click();
  await a.locator('#reception-delete').waitFor({ state: 'visible' });
  await a.waitForFunction(() => !document.querySelector('#reception-session').value);
  const room = packs[0].scenes[0].levels.at(-1).rooms.find((r) => r.access === 'public');
  const sourced = await ask(a, `${room.name}在什么楼层？只用当前空间已发布的资料。`);
  assert.equal(sourced.result.basis, 'published');
  assert(sourced.result.sources.some((s) => s.entityId === room.entityId));
  const unknown = await ask(
    a,
    '这所学校现任校长的姓名与办公室电话号码是什么？资料没有提供不要猜。',
  );
  assert.equal(unknown.result.basis, 'unavailable');
  assert.equal(unknown.result.unknown, true);
  record('Current published school facts have citations; missing school facts remain unknown');
  await a.locator('#reception-session').selectOption(id);
  await a.waitForFunction(
    (m) => document.querySelector('#conversation').textContent.includes(m),
    marker,
  );
  const dl = a.waitForEvent('download');
  await a.locator('#reception-export').click();
  const download = await dl,
    exportPath = join(out, 'synthetic-export.json');
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  assert.equal(exported.turns.length, 3);
  assert(JSON.stringify(exported).includes(marker));
  assert(!JSON.stringify(exported).includes(process.env.DEEPSEEK_API_KEY));
  await a.screenshot({ path: join(out, 'hermes-session-before-delete.png'), fullPage: true });
  record('Browser export downloads owner transcript including restored turns without credentials');
  await a.locator('#reception-delete').click();
  await a.waitForFunction(
    (c) => ![...document.querySelector('#reception-session').options].some((o) => o.value === c),
    id,
  );
  denied(await api(alice, ownPath(id, '/export')));
  const beforeReplay = calls.length;
  denied(
    await api(alice, '/api/spaces/north/reception', {
      messageId: first.messageId,
      message: firstText,
    }),
  );
  denied(
    await api(alice, '/api/spaces/north/reception', {
      messageId: randomUUID(),
      contextId: id,
      message: '恢复删除的会话',
    }),
  );
  assert.equal(calls.length, beforeReplay);
  assert(!JSON.stringify(server.store.read()).includes(marker));
  // Deletion must scrub Base state AND any server-owned Hermes trace copies, not just hide UI.
  const residue = [];
  for (const path of await files(runtime)) {
    const bytes = await readFile(path);
    if (
      bytes.includes(Buffer.from(marker)) ||
      bytes.includes(Buffer.from(JSON.stringify(marker).slice(1, -1)))
    )
      residue.push(path.replace(runtime, 'runtime'));
  }
  assert.deepEqual(residue, [], 'Deleted synthetic transcript remains in runtime files');
  await a.reload();
  await a.locator('#reception-retention').filter({ hasText: '天' }).waitFor();
  assert(!(await a.locator('#conversation').innerText()).includes(marker));
  await a.locator('#reception-new').click();
  await a.waitForFunction(() => !document.querySelector('#reception-session').value);
  const afterDelete = await ask(
    a,
    '已经删除的会话中，我的完整测试口令是什么？本次会话未提供就回答不知道。',
  );
  assert(!afterDelete.result.text.includes(marker));
  record(
    'Delete scrubs server and Hermes files; refresh, replay and new real conversation cannot recover deleted content',
  );
  assert.deepEqual(errors, []);
  assert.equal(calls.length, 8);
  assert(children.every((c) => c.closed && c.code === 0));
  const report = {
    at: new Date().toISOString(),
    status: 'PASS',
    kind: 'real-hermes-browser-session-lifecycle',
    model: calls[0].model,
    offlineModel: false,
    identityMode: 'standalone signed HttpOnly cookie, two new isolated QA browser contexts',
    checks,
    calls,
    processes: children,
    browserErrors: errors,
    limits: [
      'Online DeepSeek via installed local Hermes, not an offline model',
      'Synthetic QA visitors, not human or physical multi-device acceptance',
      'Ubuntu/Keycloak/PostgreSQL evidence remains the separately versioned v0.8.0 acceptance',
      'Exported copies and historical backups are controlled by their retention policy, not remotely erased',
    ],
  };
  await writeFile(join(out, 'hermes-sessions-live.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: 'PASS',
      checks: checks.length,
      calls: calls.length,
      report: join(out, 'hermes-sessions-live.json'),
    }),
  );
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(
    join(out, 'process-cleanup.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browserClosed: !browser?.isConnected(),
        baseClosed: true,
        children,
      },
      null,
      2,
    ) + '\n',
  );
}
