const $ = (id) => document.getElementById(id),
  query = new URLSearchParams(location.search);
const names = {
  internship: '实习',
  job: '岗位',
  scholarship: '奖助机会',
  project: '项目',
  experience: '经验交流',
  consultation: '咨询活动',
  pending: '待审核',
  published: '已发布',
  rejected: '已驳回',
  withdrawn: '已撤回',
  suspended: '已下架',
  active: '已启用',
  requested: '待支持人确认',
  confirmed: '已确认',
  declined: '已拒绝',
  canceled: '已取消',
  completed: '已完成',
  open: '开放',
  closed: '关闭',
};
let boot,
  profile,
  epoch = 0,
  page = 0,
  opPage = 0,
  adminPage = 0;
const attempts = new Map();
const root = () => '/network/schools/' + encodeURIComponent($('school').value),
  scopeRoot = (org) =>
    '/community/schools/' +
    encodeURIComponent($('school').value) +
    (org ? '/organizations/' + encodeURIComponent(org) : '');
function node(tag, text) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  return n;
}
function report(e) {
  $('status').textContent = e.message || e;
}
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
    v = await r.json();
  if (!r.ok) throw Error(v.error?.message || v.error?.code || '操作失败');
  return v;
}
async function write(path, b) {
  const k = path + JSON.stringify(b);
  if (!attempts.has(k)) attempts.set(k, crypto.randomUUID());
  const v = await api(path, { requestId: attempts.get(k), ...b });
  attempts.delete(k);
  return v;
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn();
  } catch (e) {
    report(e);
  }
};
function button(parent, label, fn) {
  const b = node('button', label);
  b.type = 'button';
  b.onclick = run(fn);
  parent.append(b);
  return b;
}
function link(parent, label, url) {
  const a = node('a', label);
  a.href = url;
  parent.append(a);
  return a;
}
function card(container, title, lines = []) {
  const a = node('article');
  a.append(node('h3', title));
  for (const line of lines) if (line != null) a.append(node('p', line));
  $(container).append(a);
  return a;
}
function reason() {
  const v = prompt('请输入原因（至少3字）');
  if (!v || v.trim().length < 3) throw Error('操作未提交，需要至少3字的原因。');
  return v;
}
function place(id) {
  return $(id).value ? JSON.parse($(id).value) : null;
}
function placeParams() {
  const a = place('place-filter');
  return a ? { sceneId: a.sceneId, entityId: a.entityId } : {};
}
const date = (v) => new Date(v).toLocaleString();
const atPlace = (r) => {
  const p = place('place-filter');
  return !p || (r.anchor?.sceneId === p.sceneId && r.anchor?.entityId === p.entityId);
};
async function directory() {
  const at = epoch,
    d = await api(
      root() +
        '/directory?' +
        new URLSearchParams({
          query: $('query').value,
          department: $('department').value,
          year: $('year').value,
          kind: $('kind').value,
          tag: $('tag').value,
          page,
          ...placeParams(),
        }),
    );
  if (at !== epoch) return;
  $('directory').replaceChildren();
  for (const r of d.items) {
    const v = r.document,
      a = card('directory', v.name, [
        `${v.kind} · ${v.department} · ${v.year} · ${v.city}`,
        v.bio,
        v.tags.join(' / '),
        r.identityLabel,
      ]);
    if (v.mentor) button(a, '查看此人的支持时段', () => slots(r.userId));
    link(
      a,
      '申请联系（仍须对方同意）',
      '/contacts.html?' + new URLSearchParams({ school: boot.schoolId, user: r.userId }),
    );
  }
  if (!d.items.length) $('directory').append(node('p', '此范围暂无已审核且自愿加入的名片。'));
  $('page').textContent = '第 ' + (page + 1) + ' 页';
  $('previous').disabled = page === 0;
  $('next').disabled = (page + 1) * 20 >= d.total;
}
async function myProfile() {
  profile = await api(root() + '/my-profile');
  const d = profile.document || {};
  $('profile-revision').value = profile.revision;
  $('profile-state').textContent =
    (names[profile.status] || '尚未加入') +
    ' · r' +
    profile.revision +
    (profile.moderation_reason ? ' · ' + profile.moderation_reason : '');
  for (const k of ['name', 'department', 'year', 'kind', 'city', 'bio'])
    $('profile-' + k).value = d[k] || (k === 'kind' ? 'student' : '');
  $('profile-tags').value = (d.tags || []).join(',');
  $('profile-mentor').checked = d.mentor === true;
  $('profile-consent').checked = false;
  $('profile-place').value = profile.anchor ? JSON.stringify(profile.anchor) : '';
  $('withdraw-profile').disabled = !profile.revision || profile.status === 'withdrawn';
}
async function slots(mentor) {
  const at = epoch,
    d = await api(root() + '/slots' + (mentor ? '?mentor=' + encodeURIComponent(mentor) : ''));
  if (at !== epoch) return;
  $('slots').replaceChildren();
  for (const r of d.items.filter(atPlace)) {
    const a = card('slots', r.topic, [
      r.mentor_name,
      date(r.starts_at) + ' — ' + date(r.ends_at),
      '名额 ' + r.reserved + '/' + r.capacity,
    ]);
    if (r.mentor_id === boot.userId)
      button(a, '关闭时段', async () => {
        await write(root() + '/slot-close', {
          slotId: r.slot_id,
          expectedRevision: r.revision,
          reason: reason(),
        });
        await refresh();
      });
    else
      button(a, '申请支持', async () => {
        const question = prompt('希望获得什么支持？（8–1000字，只向预约双方展示）');
        if (!question) return;
        await write(root() + '/book', { slotId: r.slot_id, question });
        await refresh();
      });
  }
  if (!$('slots').children.length) $('slots').append(node('p', '当前范围暂无开放时段。'));
}
async function bookingAction(r, action) {
  await write(root() + '/booking-action', {
    bookingId: r.booking_id,
    expectedRevision: r.revision,
    action,
    reason: reason(),
  });
  await refresh();
}
function renderBooking(container, r, admin = false) {
  const a = card(container, r.topic, [
    date(r.starts_at) + ' — ' + date(r.ends_at),
    names[r.status],
    r.question,
    r.reason,
  ]);
  if (['requested', 'confirmed'].includes(r.status)) {
    button(a, '取消 / 协调取消', () => bookingAction(r, 'cancel'));
    if (r.mentor_id === boot.userId) {
      if (r.status === 'requested') {
        button(a, '确认', () => bookingAction(r, 'confirm'));
        button(a, '拒绝', () => bookingAction(r, 'decline'));
      }
      if (r.status === 'confirmed' && new Date(r.ends_at) <= new Date())
        button(a, '确认已完成', () => bookingAction(r, 'complete'));
    }
  }
}
async function bookings() {
  const at = epoch,
    d = await api(root() + '/bookings');
  if (at !== epoch) return;
  $('bookings').replaceChildren();
  d.items.forEach((r) => renderBooking('bookings', r));
}
function forumUrl(r) {
  return (
    '/community.html?' +
    new URLSearchParams({
      school: boot.schoolId,
      ...(r.org_id ? { organization: r.org_id } : {}),
      post: r.source_id,
    })
  );
}
function renderOpportunity(container, r, { admin = false, mine = false } = {}) {
  const a = card(container, r.title, [
    names[r.kind] + ' · ' + r.organization,
    '面向：' + r.audience,
    '截止：' + date(r.deadline),
    (names[r.status] || r.status) + ' · 卡片 r' + r.revision + ' / 正文 r' + r.sourceRevision,
    r.identityLabel,
  ]);
  link(a, '查看原生正文、审核及讨论', forumUrl(r));
  if (
    r.application_url &&
    r.status === 'active' &&
    new Date(r.deadline) > new Date() &&
    r.sourceStatus === 'published' &&
    r.approved_source_revision === r.sourceRevision
  ) {
    const l = link(a, '打开外部官方申请入口', r.application_url);
    l.target = '_blank';
    l.rel = 'noopener noreferrer';
  }
  if (!admin && !mine)
    button(a, r.bookmarked ? '取消收藏' : '收藏', async () => {
      await write(root() + '/bookmark', { opportunityId: r.opportunity_id, active: !r.bookmarked });
      await opportunities();
    });
  if (admin || mine) {
    button(a, '填入编辑表单', () => {
      for (const [k, v] of Object.entries({
        source: r.source_id,
        org: r.org_id || '',
        revision: r.revision,
        kind: r.kind,
        organization: r.organization,
        audience: r.audience,
        url: r.application_url,
      }))
        $('opportunity-' + k).value = v;
      const d = new Date(r.deadline);
      $('opportunity-deadline').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      $('opportunity-place').value = r.anchor ? JSON.stringify(r.anchor) : '';
      $('opportunity').scrollIntoView({ behavior: 'smooth' });
    });
    button(a, '撤回卡片', async () => {
      await write(root() + '/opportunity-withdraw', {
        opportunityId: r.opportunity_id,
        expectedRevision: r.revision,
        reason: reason(),
      });
      await refresh();
    });
  }
  if (admin && r.status !== 'withdrawn')
    button(a, '核对元数据并发布', async () => {
      await write(root() + '/opportunity-approve', {
        opportunityId: r.opportunity_id,
        expectedRevision: r.revision,
        reason: reason(),
      });
      await refresh();
    });
}
async function opportunities() {
  const at = epoch,
    d = await api(
      root() +
        '/opportunities?' +
        new URLSearchParams({
          kind: $('opportunity-filter').value,
          page: opPage,
          ...placeParams(),
        }),
    );
  if (at !== epoch) return;
  $('opportunities').replaceChildren();
  d.items.forEach((r) => renderOpportunity('opportunities', r));
  if (!d.items.length) $('opportunities').append(node('p', '此范围暂无已审核且未到期的机会。'));
  $('opportunity-page').textContent = '第 ' + (opPage + 1) + ' 页';
  $('opportunity-prev').disabled = opPage === 0;
  $('opportunity-next').disabled = !d.hasMore;
  const mine = await api(root() + '/my-opportunities');
  if (at !== epoch) return;
  $('my-opportunities').replaceChildren();
  mine.items.forEach((r) => renderOpportunity('my-opportunities', r, { mine: true }));
}
async function admin() {
  if (!boot.canModerate && !boot.canOpportunityModerate) return;
  const suffix = '?page=' + adminPage;
  const at = epoch,
    profiles = boot.canModerate ? await api(root() + '/review' + suffix) : { items: [] },
    sl = boot.canModerate ? await api(root() + '/slot-admin' + suffix) : { items: [] },
    bk = boot.canModerate ? await api(root() + '/booking-admin' + suffix) : { items: [] },
    op = await api(root() + '/opportunity-admin' + suffix);
  if (at !== epoch) return;
  for (const id of ['profile-review', 'slot-admin', 'booking-admin', 'opportunity-admin'])
    $(id).replaceChildren();
  for (const r of profiles.items) {
    const a = card('profile-review', r.document.name, [
      r.document.bio,
      r.document.tags.join(' / '),
      names[r.status],
      r.moderation_reason,
    ]);
    for (const action of r.status === 'pending'
      ? ['approve', 'reject']
      : r.status === 'published'
        ? ['suspend']
        : []) {
      button(a, { approve: '审核发布', reject: '驳回', suspend: '下架' }[action], async () => {
        await write(root() + '/profile-action', {
          userId: r.user_id,
          expectedRevision: r.revision,
          action,
          reason: reason(),
        });
        await refresh();
      });
    }
  }
  for (const r of sl.items) {
    const a = card('slot-admin', r.topic, [date(r.starts_at), names[r.status]]);
    if (r.status === 'open')
      button(a, '关闭并取消未完成预约', async () => {
        await write(root() + '/slot-close', {
          slotId: r.slot_id,
          expectedRevision: r.revision,
          reason: reason(),
        });
        await refresh();
      });
  }
  bk.items.forEach((r) => renderBooking('booking-admin', r, true));
  op.items.forEach((r) => renderOpportunity('opportunity-admin', r, { admin: true }));
  $('admin-page').textContent = '第 ' + (adminPage + 1) + ' 页';
  $('admin-prev').disabled = adminPage === 0;
}
async function refresh() {
  await directory();
  await slots();
  await bookings();
  await opportunities();
  if (boot.canModerate || boot.canOpportunityModerate) await admin();
  report('已按当前学校和账号权限刷新。');
}
async function schoolChange() {
  epoch++;
  page = opPage = adminPage = 0;
  boot = await api(root() + '/bootstrap');
  for (const id of ['place-filter', 'profile-place', 'slot-place', 'opportunity-place']) {
    $(id).replaceChildren(
      new Option(id === 'place-filter' ? '全部地点' : '不绑定地点', ''),
      ...boot.places.map(
        (p) => new Option(p.label, JSON.stringify({ sceneId: p.sceneId, entityId: p.entityId })),
      ),
    );
  }
  const p = { sceneId: query.get('sceneId'), entityId: query.get('entityId') };
  if (boot.places.some((x) => x.sceneId === p.sceneId && x.entityId === p.entityId))
    $('place-filter').value = JSON.stringify(p);
  $('opportunity-kind').replaceChildren(...boot.kinds.map((k) => new Option(names[k], k)));
  $('opportunity-filter').replaceChildren(
    new Option('全部', ''),
    ...boot.kinds.map((k) => new Option(names[k], k)),
  );
  $('forum-entry').href = '/community.html?' + new URLSearchParams({ school: boot.schoolId });
  $('admin').hidden = !boot.canModerate && !boot.canOpportunityModerate;
  $('school-admin').hidden = !boot.canModerate;
  await myProfile();
  $('workspace').hidden = false;
  await refresh();
}
$('profile').onsubmit = run(async () => {
  const document = {};
  for (const k of ['name', 'department', 'year', 'kind', 'city', 'bio'])
    document[k] = $('profile-' + k).value;
  document.tags = $('profile-tags')
    .value.split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  document.mentor = $('profile-mentor').checked;
  await write(root() + '/profile', {
    expectedRevision: +$('profile-revision').value,
    consent: $('profile-consent').checked,
    document,
    anchor: place('profile-place'),
  });
  await myProfile();
  await refresh();
});
$('withdraw-profile').onclick = run(async () => {
  await write(root() + '/profile-action', {
    userId: boot.userId,
    expectedRevision: profile.revision,
    action: 'withdraw',
    reason: reason(),
  });
  await myProfile();
  await refresh();
});
$('slot').onsubmit = run(async () => {
  await write(root() + '/slot', {
    startsAt: new Date($('slot-start').value).toISOString(),
    endsAt: new Date($('slot-end').value).toISOString(),
    capacity: +$('slot-capacity').value,
    topic: $('slot-topic').value,
    anchor: place('slot-place'),
  });
  await refresh();
});
$('opportunity').onsubmit = run(async () => {
  await write(root() + '/opportunity', {
    sourceId: $('opportunity-source').value.trim(),
    orgId: $('opportunity-org').value.trim() || null,
    expectedRevision: +$('opportunity-revision').value,
    kind: $('opportunity-kind').value,
    organization: $('opportunity-organization').value,
    audience: $('opportunity-audience').value,
    deadline: new Date($('opportunity-deadline').value).toISOString(),
    applicationUrl: $('opportunity-url').value,
    anchor: place('opportunity-place'),
  });
  await refresh();
  report('机会卡片已提交核对；请保留正文与卡片编号。');
});
$('search').onsubmit = run(async () => {
  page = 0;
  await directory();
});
$('previous').onclick = run(async () => {
  page = Math.max(0, page - 1);
  await directory();
});
$('next').onclick = run(async () => {
  page++;
  await directory();
});
$('opportunity-prev').onclick = run(async () => {
  opPage = Math.max(0, opPage - 1);
  await opportunities();
});
$('opportunity-next').onclick = run(async () => {
  opPage++;
  await opportunities();
});
$('opportunity-filter').onchange = run(async () => {
  opPage = 0;
  await opportunities();
});
$('load-admin').onclick = run(admin);
$('admin-prev').onclick = run(async () => {
  adminPage = Math.max(0, adminPage - 1);
  await admin();
});
$('admin-next').onclick = run(async () => {
  adminPage++;
  await admin();
});
$('refresh').onclick = run(refresh);
$('school').onchange = run(schoolChange);
$('place-filter').onchange = run(async () => {
  page = opPage = 0;
  await refresh();
});
try {
  const me = await api('/m0/me');
  $('school').replaceChildren(
    ...me.schools
      .filter((s) => !['partner', 'affiliate'].includes(s.role))
      .map((s) => new Option(s.school_id, s.school_id)),
  );
  if (!me.extensions.includes('network')) throw Error('此部署尚未启用校园连接扩展。');
  if ([...$('school').options].some((o) => o.value === query.get('school')))
    $('school').value = query.get('school');
  if (!$('school').value) throw Error('请先加入学校。');
  await schoolChange();
} catch (e) {
  report(e);
}
