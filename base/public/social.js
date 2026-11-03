const $ = (id) => document.getElementById(id);
let me,
  active = null,
  stream = null,
  canSend = false,
  listRevision = 0,
  after = '0',
  items = new Map();
const status = (s) => ($('status').textContent = s);
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error?.message || d.error?.code || '请求失败');
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
const root = () => '/m1/schools/' + encodeURIComponent($('school').value),
  contactsRoot = () => '/contacts/schools/' + encodeURIComponent($('school').value),
  org = () => $('org').value || undefined;
function el(tag, text) {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
}
function button(label, fn) {
  const b = el('button', label);
  b.onclick = run(fn);
  return b;
}
function stop() {
  stream?.close();
  stream = null;
  active = null;
  canSend = false;
  items.clear();
  $('messages').replaceChildren();
  $('controls').replaceChildren();
  $('connection').textContent = '';
  $('send').querySelector('button').disabled = true;
  delete $('send').dataset.retryId;
}
async function lists() {
  const version = ++listRevision,
    currentRoot = root(),
    currentContactsRoot = contactsRoot();
  const scope = org() ? '?org=' + encodeURIComponent(org()) : '';
  const c = await api(currentRoot + '/contacts' + scope);
  if (version !== listRevision) return;
  $('contact-nav').hidden = !c.requiresContactConsent;
  const permissions = c.requiresContactConsent
    ? (await api(currentContactsRoot + '/requests' + scope)).contacts
    : [];
  if (version !== listRevision) return;
  const permissionMap = new Map(permissions.map((p) => [p.peerId, p]));
  $('contacts').replaceChildren(
    ...c.contacts
      .filter((x) => x.user_id !== me.userId)
      .map((x) => {
        const permission = permissionMap.get(x.user_id);
        const row = el('article', x.display_name);
        if (c.requiresContactConsent && !permission?.canSend) {
          row.append(
            el('p', permission?.status === 'pending' ? '联系申请待处理' : '尚无可用私信授权'),
          );
          if (permission?.canAccept)
            row.append(
              button('接受联系', async () => {
                await api(contactsRoot() + `/requests/${permission.contactId}/accept`, {
                  requestId: crypto.randomUUID(),
                  expectedRevision: permission.revision,
                });
                await lists();
              }),
            );
          else if (!permission || permission.canRequest)
            row.append(
              button('申请联系', async () => {
                await api(contactsRoot() + '/requests', {
                  requestId: crypto.randomUUID(),
                  expectedRevision: permission?.revision || 0,
                  peerId: x.user_id,
                  orgId: org(),
                });
                status('联系申请已发送，对方接受后才可私信。');
                await lists();
              }),
            );
          const link = el('a', '管理联系授权');
          link.href = '/contacts.html';
          row.append(link);
          return row;
        }
        row.append(
          button((c.requiresContactConsent ? '私信 ' : '') + x.display_name, async () => {
            const r = await api(root() + '/chat', {
              requestId: crypto.randomUUID(),
              kind: 'dm',
              orgId: org(),
              peerId: x.user_id,
            });
            await open(r.conversationId, x.display_name);
          }),
        );
        return row;
      }),
  );
  const d = await api(currentRoot + '/chat');
  if (version !== listRevision) return;
  $('conversations').replaceChildren(
    ...d.conversations.map((v) =>
      button(
        (v.kind === 'dm' ? '私信' : '讨论室') +
          ' · ' +
          (v.org_id || '学校') +
          ' · 未读 ' +
          v.unread +
          (v.canSend === false ? ' · 只读' : ''),
        () => open(v.conversation_id, v.kind === 'dm' ? '私信' : '讨论室'),
      ),
    ),
  );
  const blocked = await api(currentRoot + '/blocks');
  if (version !== listRevision) return;
  $('blocks').replaceChildren(
    ...blocked.blocks.map((x) =>
      button(x.blocked_id + ' · 解除屏蔽', async () => {
        await api(root() + '/blocks', { userId: x.blocked_id, blocked: false });
        await lists();
      }),
    ),
  );
}
function render() {
  const box = $('messages'),
    follow = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.replaceChildren(
    ...[...items.values()].map((m) => {
      const a = el(
        'article',
        m.name +
          ' · ' +
          new Date(m.createdAt).toLocaleTimeString() +
          (m.revision > 1 && m.status === 'active' ? ' · 已编辑' : ''),
      );
      a.dataset.messageId = m.messageId;
      a.append(el('p', m.text ?? (m.status === 'expired' ? '消息已到期' : '消息已撤回')));
      if (m.senderId === me.userId && m.status === 'active') {
        if (canSend)
          a.append(
            button('修改', async () => {
              const text = prompt('修改消息', m.text);
              if (text === null) return;
              await api(root() + `/chat/${active}/messages`, {
                action: 'edit',
                messageId: m.messageId,
                expectedRevision: m.revision,
                requestId: crypto.randomUUID(),
                text,
              });
            }),
          );
        a.append(
          button('撤回', async () => {
            await api(root() + `/chat/${active}/messages`, {
              action: 'remove',
              messageId: m.messageId,
              expectedRevision: m.revision,
              requestId: crypto.randomUUID(),
            });
          }),
        );
      } else if (m.status === 'active')
        a.append(
          button('举报', async () => {
            const reason = prompt('举报原因（仅供对应审核员处理）');
            if (!reason) return;
            await api(root() + `/chat/${active}/report`, { messageId: m.messageId, reason });
            status('已提交举报。');
          }),
        );
      return a;
    }),
  );
  if (follow) box.scrollTop = box.scrollHeight;
}
async function open(id, label) {
  stop();
  active = id;
  after = '0';
  $('heading').textContent = label;
  const v = (await api(root() + '/chat')).conversations.find((x) => x.conversation_id === id);
  if (v?.kind === 'dm') {
    const peer = v.participants.find((x) => x !== me.userId);
    const permission = v.contactPermission;
    if (permission) {
      const link = el('a', '申请、撤销联系或调整私信偏好');
      link.href = '/contacts.html';
      $('controls').append(link);
      if (permission.canRequest)
        $('controls').append(
          button('申请此联系人', async () => {
            await api(contactsRoot() + '/requests', {
              requestId: crypto.randomUUID(),
              expectedRevision: permission.revision,
              peerId: peer,
              orgId: v.org_id || undefined,
            });
            status('已发送联系申请。');
            await lists();
          }),
        );
      if (permission.status === 'accepted')
        $('controls').append(
          button('撤销联系授权', async () => {
            await api(contactsRoot() + `/requests/${permission.contactId}/revoke`, {
              requestId: crypto.randomUUID(),
              expectedRevision: permission.revision,
            });
            status('已撤销授权，双方仍可读取历史及撤回自己的消息。');
            await lists();
          }),
        );
    }
    $('controls').append(
      button('屏蔽此联系人', async () => {
        await api(root() + '/blocks', { userId: peer, blocked: true });
        stop();
        await lists();
      }),
    );
  }
  stream = new EventSource(root() + `/chat/${id}/stream?after=0`);
  stream.addEventListener(
    'sync',
    run(async (e) => {
      const d = JSON.parse(e.data);
      if (active !== id) return;
      for (const m of d.items) items.set(m.messageId, m);
      after = d.cursor;
      canSend = d.canSend !== false;
      render();
      $('connection').textContent = canSend
        ? '已连接'
        : '已连接 · 私信只读：需要有效的双方联系授权，或对方关闭了私信。历史仍可查看，自己的消息仍可撤回。';
      $('send').querySelector('button').disabled = !canSend;
      const sent = Math.max(
        0,
        ...[...items.values()]
          .filter((m) => m.senderId === me.userId)
          .map((m) => Number(m.sequence)),
      );
      $('reads').textContent =
        d.reads.some((r) => r.user_id !== me.userId) && sent
          ? d.reads.some((r) => r.user_id !== me.userId && Number(r.last_sequence) >= sent)
            ? '对方已读'
            : '对方尚未读完'
          : '';
      if (d.items.length) await api(root() + `/chat/${id}/read`, { sequence: after });
    }),
  );
  stream.addEventListener('denied', () => {
    stop();
    $('connection').textContent = '会话权限或登录已失效，请重新登录或联系负责人。';
  });
  stream.onerror = () => {
    $('connection').textContent = '连接中断，正在从已收游标恢复…';
  };
  await lists();
}
async function refresh() {
  stop();
  const d = await api(root() + '/organizations');
  $('org').replaceChildren(
    new Option('学校', ''),
    ...d.organizations.map((o) => new Option(o.name, o.org_id)),
  );
  await lists();
}
$('send').onsubmit = run(async () => {
  if (!active) throw Error('请先选择会话');
  if (!canSend) throw Error('此会话当前只读，请先获得双方联系授权。');
  const text = $('text').value;
  const requestId = $('send').dataset.retryId || crypto.randomUUID();
  $('send').dataset.retryId = requestId;
  await api(root() + `/chat/${active}/messages`, { action: 'send', text, requestId });
  delete $('send').dataset.retryId;
  $('text').value = '';
});
$('text').oninput = () => delete $('send').dataset.retryId;
$('room').onclick = run(async () => {
  const d = await api(root() + '/chat', {
    requestId: crypto.randomUUID(),
    kind: 'room',
    orgId: org(),
  });
  await open(d.conversationId, '范围讨论室');
});
$('school').onchange = run(refresh);
$('org').onchange = run(async () => {
  stop();
  await lists();
});
$('refresh').onclick = run(lists);
$('reportsButton').onclick = run(async () => {
  const d = await api(root() + '/reports' + (org() ? '?org=' + encodeURIComponent(org()) : ''));
  $('reports').replaceChildren(
    ...d.reports.map((r) => {
      const a = el('article', r.reason + ' · ' + (r.resolved_at ? '已处理' : '待处理'));
      a.append(
        button('有理由审查单条消息', async () => {
          const reason = prompt('记录本次审查理由');
          if (!reason) return;
          const m = await api(
            root() + '/reports' + (org() ? '?org=' + encodeURIComponent(org()) : ''),
            { reportId: r.report_id, reason, resolve: true },
          );
          a.append(el('p', m.text ?? '已撤回或到期'));
        }),
      );
      return a;
    }),
  );
});
window.addEventListener('pagehide', stop);
$('send').querySelector('button').disabled = true;
try {
  me = await api('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  if (!me.schools.length) throw Error('请先接受学校或组织邀请。');
  status(me.name + '，请选择联系人或讨论室。');
  await refresh();
} catch (e) {
  status(e.message);
}
