const $ = (id) => document.getElementById(id),
  query = new URLSearchParams(location.search),
  labels = {
    draft: '草稿',
    pending: '待审核',
    published: '已发布',
    rejected: '已驳回',
    withdrawn: '已撤回',
    submitted: '已提交',
    claimed: '已认领',
    in_progress: '处理中',
    resolved: '已解决',
  },
  errors = {
    environment_feedback_denied: '这不是你可查看的反馈。',
    environment_place_inactive: '此地点目前未开放处理。',
    environment_anchor_assigned: '此地点已被分配，请刷新后查看。',
    revision_conflict: '记录已有更新，请刷新再核对。',
    organization_denied: '当前组织权限已失效。',
    moderation_denied: '当前账号没有此地点的审核权限。',
    school_owner_required: '首次地点分配需要学校负责人。',
    organization_owner_required: '需要所属组织负责人权限。',
    feedback_already_claimed: '另一位当前有效处理者已经认领。',
    feedback_assignee_required: '请由认领此反馈的处理者操作。',
    feedback_processing_required: '请先标记处理中，再确认解决。',
    public_role_label_not_contact: '公开称谓请只填写职务，不填写联系方式或账号标识。',
  };
let me = null,
  places = [],
  current,
  announcements = [],
  mode = 'mine',
  epoch = 0;
const attempts = new Map(),
  school = () => $('school').value.trim(),
  root = () => '/environment/schools/' + encodeURIComponent(school());
function el(tag, text) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  return n;
}
function status(text, bad = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', bad);
}
async function api(path, b) {
  let r;
  try {
    r = await fetch(path, {
      method: b ? 'POST' : 'GET',
      headers: b ? { 'Content-Type': 'application/json' } : {},
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
  } catch {
    throw Error('连接中断。请保留输入，重试同一次操作。');
  }
  const v = await r.json();
  if (!r.ok) {
    const code = v.error?.code || v.error?.message;
    throw Object.assign(Error(errors[code] || '操作未完成：' + code), { status: r.status });
  }
  return v;
}
async function write(path, b) {
  const k = path + JSON.stringify(b);
  if (!attempts.has(k)) attempts.set(k, crypto.randomUUID());
  try {
    const r = await api(path, { requestId: attempts.get(k), ...b });
    attempts.delete(k);
    return r;
  } catch (e) {
    if (e.status && e.status < 500) attempts.delete(k);
    throw e;
  }
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    status(e.message, true);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
};
function button(label, fn) {
  const b = el('button', label);
  b.type = 'button';
  b.onclick = run(fn);
  return b;
}
function selected() {
  return places.find((x) => x.sceneId + '|' + x.entityId === $('place').value);
}
async function candidates() {
  if (!current?.canAssign) return;
  const q = new URLSearchParams(
      current.placeId
        ? { placeId: current.placeId }
        : $('organization').value
          ? { org: $('organization').value }
          : {},
    ),
    id = current.sceneId + '|' + current.entityId,
    r = await api(root() + '/candidates?' + q);
  if (id !== $('place').value) return;
  $('manager-user').replaceChildren(
    new Option('暂不指定人员', ''),
    ...r.candidates.map((u) => new Option(u.name, u.userId)),
  );
  $('manager-user').value = current.managerUserId || '';
}
function announcementCard(n) {
  const card = el('article');
  card.dataset.announcementId = n.announcementId;
  card.append(el('strong', n.title + ' · ' + labels[n.status]), el('p', n.body));
  if (['draft', 'rejected'].includes(n.status)) {
    card.append(
      button('编辑草稿', async () => {
        $('announcement-id').value = n.announcementId;
        $('announcement-title').value = n.title;
        $('announcement-body').value = n.body;
        $('announcement-title').focus();
      }),
      button('提交审核', async () => {
        await write(root() + '/announcements/' + n.announcementId + '/submit', {
          expectedRevision: n.revision,
        });
        await refresh();
      }),
    );
  }
  if (current.canReview && n.status === 'pending')
    for (const decision of ['publish', 'reject'])
      card.append(
        button(decision === 'publish' ? '审核发布' : '驳回草稿', async () => {
          const reason = prompt('请输入审核理由（至少3字）');
          if (!reason) return;
          await write(root() + '/announcements/' + n.announcementId + '/review', {
            expectedRevision: n.revision,
            decision,
            reason,
          });
          await refresh();
        }),
      );
  if (current.canReview && n.status === 'published')
    card.append(
      button('撤回公告', async () => {
        const reason = prompt('请输入撤回理由（至少3字）');
        if (!reason) return;
        await write(root() + '/announcements/' + n.announcementId + '/withdraw', {
          expectedRevision: n.revision,
          reason,
        });
        await refresh();
      }),
    );
  return card;
}
async function feedback() {
  const p = current,
    v = epoch;
  $('feedback-list').replaceChildren();
  if (!me || !p?.placeId) {
    $('feedback-list').append(el('p', '登录并选择已开放反馈的地点后，可查看自己的记录。'));
    return;
  }
  if (mode === 'manage' && !p.canHandle) mode = 'mine';
  const r = await api(root() + '/feedback?' + new URLSearchParams({ placeId: p.placeId, mode }));
  if (v !== epoch) return;
  $('feedback-list').replaceChildren(
    ...r.items.map((f) => {
      const card = el('article');
      card.dataset.feedbackId = f.feedbackId;
      card.append(
        el('strong', (f.kind === 'problem' ? '地点问题' : '改善建议') + ' · ' + labels[f.status]),
        el('p', f.body),
      );
      if (f.authorName) card.append(el('small', '提交者：' + f.authorName));
      if (f.resolution) card.append(el('p', '处理说明：' + f.resolution));
      const transition = (state, title) =>
        button(title, async () => {
          const reason = prompt('请说明本次处理情况（至少3字）');
          if (!reason) return;
          await write(root() + '/feedback/' + f.feedbackId + '/transition', {
            expectedRevision: f.revision,
            status: state,
            reason,
          });
          await feedback();
          status('反馈状态已更新，提交者可查看处理进度。');
        });
      if (f.canClaim && !f.claimedByMe) card.append(transition('claimed', '认领处理'));
      if (f.canAdvance) {
        if (f.status === 'claimed') card.append(transition('in_progress', '开始处理'));
        if (f.status === 'in_progress') card.append(transition('resolved', '确认解决'));
        card.append(transition('rejected', '驳回并说明'));
      }
      return card;
    }),
  );
  if (!r.items.length)
    $('feedback-list').append(
      el('p', mode === 'manage' ? '本地点暂无待查看的反馈。' : '你尚未提交此地点反馈。'),
    );
}
async function show() {
  ++epoch;
  current = selected();
  $('announcement-list').replaceChildren();
  $('feedback-list').replaceChildren();
  $('assignment').hidden = true;
  $('announcement-manager').hidden = true;
  $('feedback-form').hidden = true;
  if (!current) {
    $('place-name').textContent = '暂无公共地点';
    return;
  }
  $('place-name').textContent = current.name;
  $('public-duty').textContent = current.publicRoleLabel
    ? '公开服务职务：' + current.publicRoleLabel
    : '尚未发布地点服务职务。';
  $('public-notices').replaceChildren(
    ...current.announcements.map((n) => {
      const a = el('article');
      a.append(el('h3', n.title), el('p', n.body));
      return a;
    }),
  );
  if (!current.announcements.length) $('public-notices').append(el('p', '此地点暂无已审核公告。'));
  $('role').textContent = current.canAssign
    ? '你的能力：地点分配、公告草稿与反馈处理；审核权限按当前学校/组织角色生效。'
    : current.canReview
      ? '你的能力：本地点公告审核及反馈处理，无法修改其他范围或空间几何。'
      : current.canHandle
        ? '你的能力：本地点受托负责人，可写公告草稿和处理反馈，发布需管理员审核。'
        : me
          ? '你的能力：参观、阅读公开公告、提交并查看自己的反馈。'
          : '访客模式：参观与阅读公开公告。登录本校账号后可提出问题和建议。';
  $('feedback-guide').textContent = current.canFeedback
    ? '反馈正文只有你和此地点当前处理人员能看到。'
    : !me
      ? '请登录本校账号后提交反馈。'
      : !current.placeId
        ? '此地点尚未分配处理团队，请联系学校负责人。'
        : '当前账号尚无本校反馈权限。';
  $('feedback-form').hidden = !current.canFeedback;
  $('managed-feedback').hidden = !current.canHandle;
  $('my-feedback').hidden = !me;
  if (current.canAssign) {
    $('assignment').hidden = false;
    const organizations = await api(
      '/m1/schools/' + encodeURIComponent(school()) + '/organizations',
    );
    $('organization').replaceChildren(
      new Option('学校团队', ''),
      ...organizations.organizations.map((o) => new Option(o.name, o.org_id)),
    );
    $('organization').value = current.orgId || '';
    $('organization').disabled = Boolean(current.placeId);
    $('role-label').value = current.configuredRoleLabel || '';
    $('publish-label').checked = Boolean(current.roleLabelPublished);
    await candidates();
  }
  if (current.canHandle) {
    $('announcement-manager').hidden = false;
    const v = epoch,
      r = await api(root() + '/announcements?placeId=' + current.placeId);
    if (v !== epoch) return;
    announcements = r.announcements;
    $('announcement-list').replaceChildren(...announcements.map(announcementCard));
  }
  await feedback();
  document.body.dataset.ready = current.sceneId + '|' + current.entityId;
}
async function refresh() {
  const previous = $('place').value,
    s = school();
  if (!s) throw Error('请从学校空间入口进入，或填写学校标识。');
  const logged = me?.schools.some((x) => x.school_id === s),
    r = await api(
      logged
        ? root() + '/places'
        : '/environment/public/schools/' + encodeURIComponent(s) + '/places',
    );
  if (s !== school()) return;
  places = r.places;
  $('place').replaceChildren(
    ...places.map((p) => new Option(p.name, p.sceneId + '|' + p.entityId)),
  );
  const requested = query.get('sceneId') + '|' + query.get('entityId');
  $('place').value = places.some((p) => p.sceneId + '|' + p.entityId === previous)
    ? previous
    : places.some((p) => p.sceneId + '|' + p.entityId === requested)
      ? requested
      : places[0]
        ? places[0].sceneId + '|' + places[0].entityId
        : '';
  await show();
  status('已读取此地点当前公开信息与角色权限。');
}
$('assignment-form').onsubmit = run(async () => {
  const b = {
    managerUserId: $('manager-user').value || null,
    publicRoleLabel: $('role-label').value,
    publishRoleLabel: $('publish-label').checked,
  };
  if (current.placeId) b.expectedRevision = current.revision;
  else
    Object.assign(b, {
      sceneId: current.sceneId,
      entityId: current.entityId,
      orgId: $('organization').value || null,
    });
  await write(root() + '/places' + (current.placeId ? '/' + current.placeId + '/manage' : ''), b);
  await refresh();
  status('地点分配已保存，仅公开明确勾选的职务称谓。');
});
$('feedback-form').onsubmit = run(async () => {
  await write(root() + '/feedback', {
    placeId: current.placeId,
    kind: $('feedback-kind').value,
    body: $('feedback-body').value,
  });
  $('feedback-body').value = '';
  mode = 'mine';
  await feedback();
  status('反馈已提交，可在这里查看后续处理。');
});
$('announcement-form').onsubmit = run(async () => {
  const id = $('announcement-id').value,
    b = { title: $('announcement-title').value, body: $('announcement-body').value };
  if (id) b.expectedRevision = announcements.find((x) => x.announcementId === id).revision;
  else b.placeId = current.placeId;
  await write(root() + '/announcements' + (id ? '/' + id + '/edit' : ''), b);
  $('announcement-id').value = '';
  $('announcement-title').value = '';
  $('announcement-body').value = '';
  await refresh();
  status('公告草稿已保存，提交审核后才能公开。');
});
function clearAnnouncement() {
  $('announcement-id').value = '';
  $('announcement-title').value = '';
  $('announcement-body').value = '';
}
$('new-announcement').onclick = clearAnnouncement;
$('organization').onchange = run(candidates);
$('my-feedback').onclick = run(async () => {
  mode = 'mine';
  await feedback();
});
$('managed-feedback').onclick = run(async () => {
  mode = 'manage';
  await feedback();
});
$('place').onchange = run(async () => {
  mode = 'mine';
  clearAnnouncement();
  await show();
});
$('school-load').onclick = run(refresh);
$('refresh').onclick = run(refresh);
try {
  try {
    me = await api('/m0/me');
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  $('schools').replaceChildren(
    ...(me?.schools || []).map((s) => new Option(s.name || s.school_id, s.school_id)),
  );
  let resolvedSchool = query.get('school');
  if (!resolvedSchool && query.get('spaceId')) {
    const mapping = await api(
      '/environment/public/spaces/' + encodeURIComponent(query.get('spaceId')) + '/places',
    );
    resolvedSchool = mapping.schoolId;
  }
  $('school').value = resolvedSchool || me?.schools[0]?.school_id || '';
  await refresh();
} catch (e) {
  status(e.message, true);
}
