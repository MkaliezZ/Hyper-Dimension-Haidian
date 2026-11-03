const $ = (id) => document.getElementById(id);
let data,
  epoch = 0;
const root = () => '/reception-admin/schools/' + encodeURIComponent($('school').value);
async function api(path, b) {
  const r = await fetch(
      path,
      b
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b),
          }
        : {},
    ),
    d = await r.json();
  if (!r.ok) throw Error(d.error?.message || d.error?.code || '请求失败');
  return d;
}
function report(e) {
  $('status').textContent = e.message || e;
}
async function refresh() {
  const at = ++epoch,
    d = await api(root() + '/status');
  if (at !== epoch) return;
  data = d;
  const p = d.policy;
  $('days').value = p.retentionDays;
  $('sessions').value = p.maxSessions;
  $('turns').value = p.maxTurns;
  $('context').value = p.contextTurns;
  $('summary').textContent =
    '共 ' +
    d.total +
    ' 个会话索引，以下最多显示最近 200 条。删除/到期项仅保留防重放元数据。接待任务失败数：' +
    (d.taskStates?.TASK_STATE_FAILED || 0) +
    '。';
  $('diagnostics').replaceChildren();
  for (const s of d.sessions) {
    const n = document.createElement('p');
    n.textContent =
      s.contextId +
      ' · ' +
      s.status +
      ' · ' +
      s.turnCount +
      ' 轮 · ' +
      new Date(s.expiresAt).toLocaleString();
    $('diagnostics').append(n);
  }
  $('status').textContent = '已读取政策 r' + p.revision + '，未读取对话正文。';
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn();
  } catch (e) {
    report(e);
  }
};
$('refresh').onclick = run(refresh);
$('school').onchange = run(refresh);
$('policy').onsubmit = run(async () => {
  await api(root() + '/policy', {
    requestId: crypto.randomUUID(),
    expectedRevision: data.policy.revision,
    policy: {
      retentionDays: +$('days').value,
      maxSessions: +$('sessions').value,
      maxTurns: +$('turns').value,
      contextTurns: +$('context').value,
    },
    reason: $('reason').value,
  });
  await refresh();
});
$('expire').onclick = run(async () => {
  const reason = prompt('请输入本次清理原因（至少3字）');
  if (!reason) return;
  const r = await api(root() + '/expire', { requestId: crypto.randomUUID(), reason });
  await refresh();
  report('本次清理 ' + r.expired + ' 个到期会话。');
});
try {
  const me = await api('/m0/me');
  const schools = me.schools.filter((s) => ['owner', 'moderator'].includes(s.role));
  $('school').replaceChildren(...schools.map((s) => new Option(s.school_id, s.school_id)));
  const requested = new URLSearchParams(location.search).get('school');
  if (schools.some((s) => s.school_id === requested)) $('school').value = requested;
  if (!schools.length) throw Error('当前账号没有学校会话管理权限。');
  $('save').disabled = schools.find((s) => s.school_id === $('school').value)?.role !== 'owner';
  await refresh();
} catch (e) {
  report(e);
}
