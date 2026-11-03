const $ = (id) => document.getElementById(id),
  request = async (path, body, method = body ? 'POST' : 'GET') => {
    const r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error?.message || d.error?.code || '请求失败');
    return d;
  };
const status = (text, error = false) => {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
};
const perform = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn();
  } catch (e) {
    status(e.message, true);
  }
};
const school = () => '/m1/schools/' + encodeURIComponent($('school').value),
  scope = () =>
    school() +
    ($('organization').value
      ? '/organizations/' + encodeURIComponent($('organization').value)
      : '');
function article(text) {
  const a = document.createElement('article');
  a.textContent = text;
  return a;
}
async function refresh() {
  const root = scope(),
    orgs = await request(school() + '/organizations');
  $('orgs').replaceChildren(
    ...orgs.organizations.map((o) => article(o.name + ' · ' + o.kind + ' · ' + o.org_id)),
  );
  const selected = $('organization').value;
  $('organization').replaceChildren(
    new Option('学校', ''),
    ...orgs.organizations.map((o) => new Option(o.name, o.org_id)),
  );
  $('organization').value = selected;
  const inviteRole = $('role').value,
    roleOptions = selected
      ? [
          ['member', '组织成员'],
          ['moderator', '组织审核员'],
          ['partner', '合作方成员'],
        ]
      : [
          ['student', '学校成员'],
          ['moderator', '学校审核员'],
        ];
  $('role').replaceChildren(...roleOptions.map(([id, label]) => new Option(label, id)));
  if (roleOptions.some(([id]) => id === inviteRole)) $('role').value = inviteRole;
  try {
    const d = await request(root + '/members');
    $('members').replaceChildren(
      ...d.members.map((m) => {
        const a = article(
            m.user_id +
              ' · ' +
              m.role +
              ' · ' +
              (m.active ? '有效' : '已撤权') +
              ' · v' +
              m.revision,
          ),
          role = document.createElement('select');
        for (const value of $('organization').value
          ? ['member', 'moderator', 'owner', 'partner']
          : ['student', 'moderator', 'owner', 'partner', 'affiliate'])
          role.add(new Option(value, value));
        role.value = m.role;
        a.append(role);
        const save = document.createElement('button');
        save.textContent = '保存角色';
        save.onclick = perform(async () => {
          await request(root + '/members', {
            requestId: crypto.randomUUID(),
            userId: m.user_id,
            role: role.value,
            active: m.active,
            expectedRevision: m.revision,
          });
          await refresh();
          status('权限变更已保存并记入审计。');
        });
        a.append(save);
        const revoke = document.createElement('button');
        revoke.textContent = m.active ? '撤销' : '恢复';
        revoke.onclick = perform(async () => {
          await request(root + '/members', {
            requestId: crypto.randomUUID(),
            userId: m.user_id,
            role: m.role,
            active: !m.active,
            expectedRevision: m.revision,
          });
          await refresh();
        });
        a.append(revoke);
        return a;
      }),
    );
  } catch (e) {
    $('members').textContent = '当前账号没有成员管理权限。';
  }
  try {
    const d = await request(root + '/forum');
    $('posts').replaceChildren(
      ...d.items.map((i) => {
        const a = article(i.title + ' · ' + i.status);
        const link = document.createElement('a');
        link.textContent = i.hasDraft ? '查看待审修订' : '查看原帖与编辑';
        link.href =
          '/forum-editor.html?' +
          new URLSearchParams({
            school: $('school').value,
            id: i.id,
            ...($('organization').value ? { org: $('organization').value } : {}),
          });
        a.append(link);
        for (const action of ['approve', 'withdraw']) {
          const b = document.createElement('button');
          b.textContent = action === 'approve' ? '审核发布' : '撤回';
          b.onclick = perform(async () => {
            await request(root + '/forum', { action, id: i.id, requestId: crypto.randomUUID() });
            await refresh();
            status('审核结果已保存。');
          });
          a.append(b);
        }
        return a;
      }),
    );
  } catch (e) {
    $('posts').textContent = '当前范围不可读取。';
  }
  try {
    const d = await request(school() + '/notifications');
    $('notifications').replaceChildren(
      ...d.items.map((n) => {
        const a = article(
          (n.read_at ? '已读' : '未读') + ' · ' + n.payload.status + ' · ' + n.payload.delta,
        );
        const b = document.createElement('button');
        b.textContent = '标记已读';
        b.onclick = perform(async () => {
          await request(school() + '/notifications', { id: n.id });
          await refresh();
        });
        a.append(b);
        return a;
      }),
    );
  } catch (e) {
    $('notifications').textContent = '通知不可用。';
  }
  try {
    $('audit').textContent = JSON.stringify((await request(school() + '/audit')).entries, null, 2);
  } catch {
    $('audit').textContent = '仅学校负责人可读审计记录。';
  }
}
async function load() {
  try {
    const me = await request('/m0/me');
    $('login').hidden = true;
    $('logout').hidden = false;
    $('school').replaceChildren(
      ...me.schools.map((s) => new Option(s.school_id + ' · ' + s.role, s.school_id)),
    );
    $('workspace').hidden = !me.schools.length;
    status(
      me.name +
        (me.schools.length ? '，请选择学校与组织范围。' : '，账号已登录，请接受邀请加入学校。'),
    );
    if (me.extensions?.includes('m2')) $('avatar-link').href = '/m2.html';
    const query = new URLSearchParams(location.search),
      chosen = query.get('school');
    if (me.schools.some((s) => s.school_id === chosen)) $('school').value = chosen;
    if (me.schools.length) await refresh();
    if (query.has('m2draft') && me.extensions?.includes('m2')) {
      const draft = await request(
        '/m2/schools/' +
          encodeURIComponent($('school').value) +
          '/collections/' +
          encodeURIComponent(query.get('m2draft')),
      );
      if (draft.kind === 'note') {
        $('title').value = '校园记忆 · ' + draft.payload.roomName;
        $('content').value = draft.payload.text + '\n\n地点：' + draft.payload.roomName;
        status('已载入私人记忆草稿。请确认后点击“提交审核”；尚未公开。');
        $('title').scrollIntoView({ block: 'center' });
      }
    }
  } catch {
    status('请登录或注册账号。注册需验证邮箱，忘记密码可在登录页找回。');
  }
}
$('accept').onsubmit = perform(async () => {
  await request('/m1/invitations/accept', { token: $('inviteToken').value.trim() });
  $('inviteToken').value = '';
  await load();
});
$('invite').onsubmit = perform(async () => {
  const d = await request(scope() + '/invitations', {
    requestId: crypto.randomUUID(),
    email: $('email').value.trim(),
    role: $('role').value,
  });
  $('inviteResult').textContent =
    '一次性邀请（48小时内有效，请通过受信渠道交给指定邮箱持有人）：' + d.token;
  status('邀请已创建，账号仍须验证邮箱。');
});
$('createOrg').onsubmit = perform(async () => {
  await request(school() + '/organizations', {
    requestId: crypto.randomUUID(),
    orgId: $('orgId').value,
    name: $('orgName').value,
    kind: $('orgKind').value,
  });
  await refresh();
  status('组织已创建。');
});
$('submit').onsubmit = perform(async () => {
  await request(scope() + '/forum', {
    action: 'submit',
    requestId: crypto.randomUUID(),
    title: $('title').value,
    content: $('content').value,
  });
  await refresh();
  status('已进入审核队列。');
});
$('reconcile').onclick = perform(async () => {
  $('reconcileResult').textContent = JSON.stringify(
    await request(school() + '/reconcile', {}),
    null,
    2,
  );
  await refresh();
  status('对账完成；如有 blocked 项，需要维护者检查。');
});
$('logout').onclick = perform(async () => {
  await request('/auth/logout', {});
  location.reload();
});
$('refresh').onclick = perform(refresh);
$('school').onchange = perform(async () => {
  $('organization').value = '';
  await refresh();
});
$('organization').onchange = perform(refresh);
await load();
