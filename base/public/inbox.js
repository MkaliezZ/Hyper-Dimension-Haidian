const $ = (id) => document.getElementById(id),
  labels = {
    announcements: '学校与组织公告',
    community: '社区内容',
    activities: '活动动态',
    partners: '合作服务',
  };
let me,
  prefs,
  subscriptions = [],
  organizations = [],
  inboxCursor = '0',
  inboxItems = [];
const restricted = () =>
  ['partner', 'affiliate'].includes(
    me.schools.find((s) => s.school_id === $('school').value)?.role,
  );
const root = () => '/information/schools/' + encodeURIComponent($('school').value);
const scope = () => $('scope').value;
const el = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const api = async (path, body) => {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Object.assign(Error(d.error?.message || '读取失败'), { status: r.status });
  return d;
};
const run = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn(e);
    $('status').textContent = '已更新';
  } catch (e) {
    $('status').textContent = e.message;
  }
};
function button(title, fn) {
  const b = el('button', title);
  b.onclick = run(fn);
  return b;
}
async function load() {
  [prefs, { items: subscriptions }] = await Promise.all([
    api(root() + '/preferences'),
    api(root() + '/subscriptions'),
  ]);
  $('enabled').checked = prefs.enabled;
  const canSubscribe = !restricted() || Boolean(scope());
  $('subscriptions').hidden = !canSubscribe;
  $('scope-note').textContent = canSubscribe
    ? '当前范围的已发布动态。'
    : '你可以查看自己的业务回执；加入组织后可订阅该组织动态。';
  $('subscriptions').replaceChildren(
    ...Object.entries(labels).map(([topic, label]) => {
      const row = el('label', ''),
        box = document.createElement('input');
      box.type = 'checkbox';
      const s = subscriptions.find((x) => x.topic === topic && x.scope_id === scope());
      box.checked = s?.active || false;
      box.onchange = run(async () => {
        box.disabled = true;
        try {
          await api(root() + '/subscriptions', {
            requestId: crypto.randomUUID(),
            expectedRevision: s?.revision || 0,
            scopeId: scope(),
            topic,
            active: box.checked,
          });
        } finally {
          await load();
        }
      });
      row.append(box, el('span', label));
      return row;
    }),
  );
  const own = me.schools.find((s) => s.school_id === $('school').value)?.role === 'owner';
  $('publisher').hidden = !(own || (scope() && organizations.some((o) => o.org_id === scope())));
  await Promise.all([
    inbox(),
    canSubscribe
      ? announcements()
      : Promise.resolve().then(() => {
          $('publisher').hidden = true;
        }),
  ]);
}
async function inbox(more = false) {
  const d = await api(root() + '/inbox?latest=true&before=' + (more ? inboxCursor : '0'));
  inboxCursor = d.cursor;
  inboxItems = more ? [...inboxItems, ...d.items] : d.items;
  $('older').hidden = !d.hasMore;
  $('messages').replaceChildren(
    ...inboxItems.map((n) => {
      const a = el('article', '');
      a.dataset.notificationId = n.id;
      a.append(
        el(
          'strong',
          n.payload.title || `内容${n.payload.status === 'published' ? '已发布' : '状态已更新'}`,
        ),
        el('p', new Date(n.created_at).toLocaleString()),
      );
      if (!n.read_at)
        a.append(
          button('标记已读', async () => {
            await api(root() + '/read', { id: n.id });
            await inbox();
          }),
        );
      else a.append(el('small', '已读'));
      return a;
    }),
  );
  if (!inboxItems.length) $('messages').append(el('p', '当前没有可见通知。'));
}
async function announcements() {
  const d = await api(root() + '/announcements?org=' + encodeURIComponent(scope()));
  $('publisher').hidden = !d.canPublish;
  $('announcements').replaceChildren(
    ...d.items.map((n) => {
      const a = el('article', n.title);
      a.append(
        button('撤回', async () => {
          await api(root() + '/announcements', {
            requestId: crypto.randomUUID(),
            sourceId: n.source_id,
            expectedRevision: n.revision,
            scopeId: scope(),
            title: '',
            status: 'withdrawn',
          });
          await load();
        }),
      );
      return a;
    }),
  );
}
$('enabled').onchange = run(async () => {
  try {
    await api(root() + '/preferences', {
      requestId: crypto.randomUUID(),
      expectedRevision: prefs.revision,
      enabled: $('enabled').checked,
    });
  } finally {
    await load();
  }
});
$('scope').onchange = run(load);
$('refresh').onclick = run(() => inbox());
$('older').onclick = run(() => inbox(true));
$('announce').onsubmit = run(async () => {
  await api(root() + '/announcements', {
    requestId: crypto.randomUUID(),
    sourceId: crypto.randomUUID(),
    expectedRevision: 0,
    scopeId: scope(),
    title: $('title').value,
    status: 'published',
    expiresAt: $('expiry').value ? new Date($('expiry').value).toISOString() : null,
  });
  $('title').value = '';
  await load();
});
async function school() {
  organizations = (
    await api('/m1/schools/' + encodeURIComponent($('school').value) + '/organizations')
  ).organizations;
  $('scope').replaceChildren(
    new Option('全校', ''),
    ...organizations.map((o) => new Option(o.name, o.org_id)),
  );
  await load();
}
$('school').onchange = run(school);
try {
  me = await api('/m0/me');
  if (!me.extensions.includes('campus')) throw Error('此实例尚未启用校园功能');
  if (!me.schools.length) throw Error('当前账号尚未加入本实例的学校。');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  await school();
  $('status').textContent = '已连接学校账号';
} catch (e) {
  $('status').textContent = e.status === 401 ? '登录后管理自己的订阅与通知。' : e.message;
  $('login').hidden = e.status !== 401;
}
