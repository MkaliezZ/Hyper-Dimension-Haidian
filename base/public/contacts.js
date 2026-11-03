const $ = (id) => document.getElementById(id);
let me,
  preference,
  viewRevision = 0;
const root = () => '/contacts/schools/' + encodeURIComponent($('school').value),
  social = () => '/m1/schools/' + encodeURIComponent($('school').value),
  org = () => $('org').value || null;
const status = (s) => ($('status').textContent = s);
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error?.code || d.error?.message || '请求失败');
  return d;
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn(e);
  } catch (e) {
    status(e.message);
  }
};
const el = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const button = (name, fn) => {
  const b = el('button', name);
  b.onclick = run(fn);
  return b;
};
const labels = {
  pending: '待对方同意',
  accepted: '已授权',
  rejected: '已拒绝',
  revoked: '已撤销',
  none: '未联系',
};
async function act(p, action) {
  await api(root() + `/requests/${p.contactId}/${action}`, {
    requestId: crypto.randomUUID(),
    expectedRevision: p.revision,
  });
  status('联系授权已更新。');
  await refresh();
}
async function request(peer, p) {
  await api(root() + '/requests', {
    requestId: crypto.randomUUID(),
    expectedRevision: p?.revision || 0,
    peerId: peer,
    orgId: org() || undefined,
  });
  status('已发出联系申请，对方接受后方可私信。');
  await refresh();
}
async function refresh() {
  const version = ++viewRevision,
    currentOrg = org();
  $('requests').replaceChildren(el('p', '正在读取当前范围…'));
  $('directory').replaceChildren();
  const suffix = currentOrg ? '?org=' + encodeURIComponent(currentOrg) : '';
  const [list, directory, pref] = await Promise.all([
    api(root() + '/requests' + suffix),
    api(social() + '/contacts' + suffix),
    api(root() + '/preferences'),
  ]);
  if (version !== viewRevision) return;
  preference = pref;
  $('accepting').checked = pref.acceptingContacts;
  $('messages').checked = pref.allowDirectMessages;
  const map = new Map(list.contacts.map((p) => [p.peerId, p]));
  $('requests').replaceChildren(
    ...list.contacts.map((p) => {
      const row = el(
        'article',
        p.name +
          ' · ' +
          (p.status === 'pending' && p.requestedBy !== me.userId ? '待你处理' : labels[p.status]),
      );
      row.dataset.contactId = p.contactId;
      if (p.canAccept) row.append(button('接受联系', () => act(p, 'accept')));
      if (p.status === 'pending' && p.requestedBy !== me.userId)
        row.append(button('拒绝联系', () => act(p, 'reject')));
      if (['pending', 'accepted'].includes(p.status))
        row.append(
          button(p.status === 'pending' ? '撤销申请' : '撤销授权', () => act(p, 'revoke')),
        );
      if (p.canRequest) row.append(button('重新申请', () => request(p.peerId, p)));
      if (p.status === 'accepted' && !p.canSend)
        row.append(el('p', '当前私信不可发送，请检查屏蔽与私信偏好。'));
      return row;
    }),
  );
  if (!list.contacts.length) $('requests').append(el('p', '当前范围还没有联系申请或授权。'));
  $('directory').replaceChildren(
    ...directory.contacts
      .filter((x) => x.user_id !== me.userId)
      .map((x) => {
        const p = map.get(x.user_id),
          row = el('article', x.display_name + ' · ' + labels[p?.status || 'none']);
        if (!p || p.canRequest) row.append(button('申请联系', () => request(x.user_id, p)));
        if (p?.canSend) {
          const a = el('a', '前往校园交流');
          a.href = '/social.html';
          row.append(a);
        }
        return row;
      }),
  );
  $('directory').dataset.scope = currentOrg || '';
}
async function schoolChange() {
  const d = await api(social() + '/organizations');
  $('org').replaceChildren(
    new Option('学校', ''),
    ...d.organizations.map((o) => new Option(o.name, o.org_id)),
  );
  await refresh();
}
$('preferences').onsubmit = run(async () => {
  await api(root() + '/preferences', {
    requestId: crypto.randomUUID(),
    expectedRevision: preference.revision,
    acceptingContacts: $('accepting').checked,
    allowDirectMessages: $('messages').checked,
  });
  status('偏好已保存。');
  await refresh();
});
$('refresh').onclick = run(refresh);
$('org').onchange = run(refresh);
$('school').onchange = run(schoolChange);
try {
  me = await api('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  if (!me.schools.length) throw Error('请先接受学校邀请。');
  const start = new URLSearchParams(location.search);
  if (me.schools.some((s) => s.school_id === start.get('school')))
    $('school').value = start.get('school');
  await schoolChange();
  status(me.name + '，请确认需要联系的人。');
} catch (e) {
  status(e.message);
}
