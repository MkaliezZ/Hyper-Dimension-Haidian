const $ = (id) => document.getElementById(id);
const el = (tag, value, klass) => {
  const e = document.createElement(tag);
  if (value !== undefined) e.textContent = value;
  if (klass) e.className = klass;
  return e;
};
const errors = {
  personal_write_conflict: '内容已在别处更新，请重新读取名片再编辑。',
  profile_write_conflict: '名片已在别处更新，请重新读取后再编辑。',
  work_link_invalid: '请填写普通的 HTTPS 作品网址，不使用本机地址、账号密码或脚本链接。',
  school_scope_denied: '只有本校成员可以使用校园名片。',
  membership_denied: '无法查看该成员，请确认对方仍是当前学校成员。',
  work_missing: '作品不存在或不属于当前账号。',
  school_owner_required: '只有当前学校负责人可以发放或撤回徽章。',
  organization_denied: '组织成员状态已变化，请重新读取名片。',
  request_conflict: '请求内容与原请求不一致，请重新读取后操作。',
  badge_revoked: '该徽章已被撤回。',
};
let me,
  school,
  state,
  editWork,
  owner,
  sequence = 0;
const pending = new Map();
const root = () => '/personal/schools/' + encodeURIComponent(school.school_id);
const notice = (v) => {
  $('status').textContent = v;
};
async function api(path, body) {
  const r = await fetch(
    path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
  const d = await r.json();
  if (!r.ok) {
    const error = Error(
      errors[d.error?.code] || errors[d.error?.message] || d.error?.message || '请求失败',
    );
    error.status = r.status;
    throw error;
  }
  return d;
}
async function save(path, values) {
  const fingerprint = JSON.stringify(values),
    prior = pending.get(path);
  const body =
    prior?.fingerprint === fingerprint ? prior.body : { requestId: crypto.randomUUID(), ...values };
  pending.set(path, { fingerprint, body });
  try {
    const r = await api(path, body);
    pending.delete(path);
    return r;
  } catch (e) {
    if (e.status && e.status < 500) pending.delete(path);
    throw e;
  }
}
const run = (fn) => async (e) => {
  e?.preventDefault?.();
  try {
    await fn(e);
  } catch (error) {
    notice(error.message);
  }
};
function choice(value) {
  const select = el('select');
  for (const [v, t] of [
    ['private', '仅自己'],
    ['school', '同校成员'],
  ]) {
    const o = el('option', t);
    o.value = v;
    select.append(o);
  }
  select.value = value;
  return select;
}
function workForm(work) {
  editWork = work || null;
  $('work-form').hidden = false;
  $('work-heading').textContent = work ? '编辑作品' : '添加作品';
  for (const key of ['title', 'description', 'link']) $('work-' + key).value = work?.[key] || '';
  $('work-status').value = work?.status || 'draft';
  $('work-visibility').value = work?.visibility || 'private';
}
async function load(target) {
  const seq = ++sequence;
  const data = await api(
    root() + (target && target !== me.userId ? '/profiles/' + encodeURIComponent(target) : '/me'),
  );
  if (seq !== sequence) return;
  state = data;
  $('target').value = state.own ? '' : state.userId;
  $('name').textContent = state.name;
  $('profile-form').hidden = !state.own;
  $('profile-view').replaceChildren();
  const names = { bio: '介绍', department: '院系', year: '年级 / 届别', interests: '兴趣' };
  for (const [key, name] of Object.entries(names)) {
    const v = state.profile.fields[key];
    if (state.own) {
      $(key).value = Array.isArray(v) ? v.join('，') : v || '';
      $('v-' + key).value = state.profile.visibility[key] || 'private';
    } else if (v?.length)
      $('profile-view').append(el('p', name + '：' + (Array.isArray(v) ? v.join(' · ') : v)));
  }
  if (!state.own && !$('profile-view').children.length)
    $('profile-view').append(el('p', '对方尚未向同校成员展示基本介绍。', 'hint'));
  $('organizations').replaceChildren();
  for (const org of state.organizations) {
    const row = el('div', undefined, 'entry');
    row.append(
      el('h3', org.name),
      el(
        'p',
        { owner: '负责人', moderator: '管理员', member: '成员', partner: '合作成员' }[org.role] ||
          org.role,
        'meta',
      ),
    );
    if (state.own) {
      const label = el('label', '组织归属可见范围'),
        select = choice(org.visibility);
      select.dataset.orgId = org.org_id;
      label.append(select);
      row.append(label);
    }
    $('organizations').append(row);
  }
  if (!state.organizations.length)
    $('organizations').append(
      el('p', state.own ? '当前没有已加入的组织。' : '对方尚未展示组织归属。', 'hint'),
    );
  $('save-organizations').hidden = !state.own || !state.organizations.length;
  $('works').replaceChildren();
  for (const work of state.works) {
    const row = el('article', undefined, 'entry');
    row.dataset.work = work.work_id;
    row.append(el('h3', work.title), el('p', work.description));
    if (work.link) {
      const a = el('a', '打开作品 ↗');
      a.href = work.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      row.append(a);
    }
    if (state.own) {
      row.append(
        el(
          'p',
          { draft: '草稿', published: '已发布', withdrawn: '已撤回' }[work.status] +
            ' · ' +
            (work.visibility === 'school' ? '同校成员' : '仅自己'),
          'meta',
        ),
      );
      const b = el('button', '编辑', 'secondary');
      b.onclick = () => workForm(work);
      row.append(b);
    }
    $('works').append(row);
  }
  if (!state.works.length)
    $('works').append(
      el(
        'p',
        state.own ? '添加一件作品，让大家了解你的兴趣与经历。' : '对方尚未展示作品。',
        'hint',
      ),
    );
  $('new-work').hidden = !state.own;
  $('work-form').hidden = true;
  editWork = null;
  $('badges').replaceChildren();
  for (const badge of state.badges) {
    const row = el('div', undefined, 'entry');
    row.dataset.badge = badge.badge_id;
    row.append(
      el('span', badge.label, 'pill'),
      el(
        'p',
        badge.status === 'revoked' ? '已撤回' : '社区认可 · ' + badge.issued_at.slice(0, 10),
        'meta',
      ),
    );
    if (state.own && badge.status === 'active') {
      const label = el('label', '徽章可见范围'),
        select = choice(badge.visibility);
      select.onchange = run(async () => {
        await save(root() + '/badges/visibility', {
          badgeId: badge.badge_id,
          expectedVersion: badge.version,
          visibility: select.value,
        });
        await load();
        notice('徽章可见范围已保存。');
      });
      label.append(select);
      row.append(label);
    }
    $('badges').append(row);
  }
  if (!state.badges.length) $('badges').append(el('p', '暂未展示社区徽章。', 'hint'));
  $('badge-admin').hidden = !owner;
  if (owner) await loadAdmin();
  const link = new URL('/profile.html', location.origin);
  link.searchParams.set('school', school.school_id);
  link.searchParams.set('user', me.userId);
  $('own-link').textContent = '我的成员 ID：' + me.userId + ' · 分享名片：' + link.href;
  window.personalQA = {
    userId: state.userId,
    own: state.own,
    works: state.works,
    organizations: state.organizations,
    badges: state.badges,
    profileVersion: state.profile.version,
  };
}
async function loadAdmin() {
  const data = await api(root() + '/badges/manage');
  $('managed-badges').replaceChildren();
  for (const b of data.badges) {
    const row = el('div', undefined, 'entry');
    row.append(el('strong', b.label), el('p', b.user_id, 'meta'));
    if (b.status === 'active') {
      const button = el('button', '撤回', 'secondary');
      button.onclick = run(async () => {
        await save(root() + '/badges/revoke', {
          badgeId: b.badge_id,
          expectedVersion: b.version,
          reason: $('revoke-reason').value,
        });
        await load(state.own ? null : state.userId);
        notice('徽章已撤回，记录已保留。');
      });
      row.append(button);
    } else row.append(el('p', '已撤回', 'meta'));
    $('managed-badges').append(row);
  }
}
$('profile-form').onsubmit = run(async () => {
  const fields = {},
    visibility = {};
  for (const k of ['bio', 'department', 'year', 'interests']) {
    fields[k] =
      k === 'interests'
        ? $(k)
            .value.split(/[,，]/)
            .map((v) => v.trim())
            .filter(Boolean)
        : $(k).value;
    visibility[k] = $('v-' + k).value;
  }
  await save('/m2/schools/' + school.school_id + '/profile', {
    expectedVersion: state.profile.version,
    fields,
    visibility,
  });
  await load();
  notice('名片与隐私已保存。');
});
$('save-organizations').onclick = run(async () => {
  const organizationVisibility = Object.fromEntries(
    [...$('organizations').querySelectorAll('select')].map((s) => [s.dataset.orgId, s.value]),
  );
  await save(root() + '/preferences', {
    expectedVersion: state.preferences.version,
    organizationVisibility,
  });
  await load();
  notice('组织可见范围已保存。');
});
$('new-work').onclick = () => workForm();
$('cancel-work').onclick = () => ($('work-form').hidden = true);
$('work-form').onsubmit = run(async () => {
  await save(root() + '/works', {
    ...(editWork ? { workId: editWork.work_id } : {}),
    expectedVersion: editWork?.version || 0,
    title: $('work-title').value,
    description: $('work-description').value,
    link: $('work-link').value,
    status: $('work-status').value,
    visibility: $('work-visibility').value,
  });
  await load();
  notice('作品已保存。草稿、撤回和仅自己可见的作品不会向其他人展示。');
});
$('issue-form').onsubmit = run(async () => {
  await save(root() + '/badges/issue', {
    userId: $('badge-user').value.trim(),
    label: $('badge-label').value,
    reason: $('badge-reason').value,
  });
  await loadAdmin();
  notice('社区徽章已发放，接收者可以自己决定展示范围。');
});
$('refresh-admin').onclick = run(async () => {
  await loadAdmin();
  notice('已刷新徽章发放记录。');
});
$('view-form').onsubmit = run(async () => {
  await load($('target').value.trim());
  notice('已读取当前可见的名片内容。');
});
$('my-profile').onclick = run(async () => {
  await load();
  notice('已恢复我的名片。');
});
async function schoolChanged() {
  school = me.schools.find((s) => s.school_id === $('school').value);
  owner = school?.role === 'owner';
  pending.clear();
  await load();
  notice('当前学校：' + school.school_id + '。资料与隐私均以服务端记录为准。');
}
$('school').onchange = run(schoolChanged);
await run(async () => {
  try {
    me = await api('/m0/me');
  } catch (e) {
    if (e.status === 401) {
      $('login').hidden = false;
      notice('登录后查看和编辑校园名片。');
      return;
    }
    throw e;
  }
  me.schools = me.schools.filter((s) => !['partner', 'affiliate'].includes(s.role));
  if (!me.schools.length) throw Error('需要已确认的学校成员身份。');
  for (const s of me.schools) {
    const o = el('option', s.name || s.school_id);
    o.value = s.school_id;
    $('school').append(o);
  }
  const query = new URLSearchParams(location.search);
  if (me.schools.some((s) => s.school_id === query.get('school')))
    $('school').value = query.get('school');
  $('workspace').hidden = false;
  await schoolChanged();
  if (query.get('user')) await load(query.get('user'));
})();
