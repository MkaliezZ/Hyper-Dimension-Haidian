const $ = (id) => document.getElementById(id),
  states = {
    created: '等待执行',
    retry: '等待自动重试',
    active: '正在执行',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消',
    not_retained: '当前队列未找到记录',
  },
  sources = {
    scheduled: '等待业务处理',
    delivered: '业务已处理',
    cancelled: '业务已取消',
    missing: '业务来源不可用',
  };
let cursor = null;
const attempts = new Map();
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
};
function status(s, bad = false) {
  $('status').textContent = s;
  $('status').classList.toggle('error', bad);
}
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok)
    throw Object.assign(
      Error(
        {
          school_owner_required: '只有学校负责人可以查看后台任务。',
          membership_denied: '当前学校成员资格已失效。',
          module_disabled: '该学校已关闭Base-3，不能发起新重试。',
          queue_job_state_changed: '任务状态已更新，请刷新后重新核对。',
          request_conflict: '同一次请求内容发生变化，请刷新再操作。',
        }[v.error?.code] || '操作未完成：' + v.error?.code,
      ),
      { status: r.status },
    );
  return v;
}
const run = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    status(e.message, true);
  }
};
async function load(after) {
  $('access').hidden = true;
  $('items').replaceChildren();
  const school = $('school').value,
    r = await api(
      '/jobs/schools/' +
        encodeURIComponent(school) +
        '/items' +
        (after ? '?after=' + encodeURIComponent(after) : ''),
    );
  if (school !== $('school').value) return;
  cursor = r.next;
  $('next').hidden = !cursor;
  $('access').hidden = false;
  $('guide').textContent = r.retryEnabled
    ? '仅显示本校任务的安全状态；失败记录可带理由重试。'
    : 'Base-3 已关闭：可查看历史状态，无法人工重试。';
  for (const j of r.items) {
    const c = el('article');
    c.dataset.jobId = j.jobId;
    c.append(
      el(
        'h3',
        (j.kind === 'activity-reminder' ? '活动提醒' : j.kind) +
          ' · ' +
          (states[j.state] || j.state),
      ),
      el('p', '业务状态：' + (sources[j.sourceState] || j.sourceState)),
      el('p', '任务编号：' + j.jobId),
      el('p', '已重试：' + (j.retryCount ?? '未知') + ' / 当前上限：' + (j.retryLimit ?? '未知')),
      el('small', '登记：' + new Date(j.createdAt).toLocaleString()),
    );
    if (j.canRetry) {
      const b = el('button', '填写理由并重试');
      b.type = 'button';
      b.onclick = run(async () => {
        const reason = prompt('先核对失败原因，再填写重试理由（至少3字）');
        if (!reason) return;
        if (reason.trim().length < 3) throw Error('重试理由至少3字。');
        const path = '/jobs/schools/' + encodeURIComponent(school) + '/items/' + j.jobId + '/retry',
          input = { expectedRetryCount: j.retryCount, reason },
          key = path + JSON.stringify(input);
        if (!attempts.has(key)) attempts.set(key, crypto.randomUUID());
        b.disabled = true;
        try {
          await api(path, { requestId: attempts.get(key), ...input });
          attempts.delete(key);
          await load();
          status('已受理原任务重试，请刷新查看执行结果。');
        } catch (e) {
          if (e.status && e.status < 500) attempts.delete(key);
          throw e;
        } finally {
          b.disabled = false;
        }
      });
      c.append(b);
    }
    $('items').append(c);
  }
  if (!r.items.length) $('items').append(el('p', '当前没有已登记的后台任务。'));
  document.body.dataset.ready = school;
  status('已读取本校后台任务。');
}
$('school').onchange = run(() => load());
$('refresh').onclick = run(() => load());
$('next').onclick = run(() => load(cursor));
try {
  const me = await api('/m0/me'),
    schools = me.schools.filter((s) => s.role === 'owner');
  $('school').replaceChildren(
    ...schools.map((s) => new Option(s.name || s.school_id, s.school_id)),
  );
  if (!schools.length) throw Error('只有学校负责人可以查看后台任务。');
  await load();
} catch (e) {
  status(e.message, true);
}
