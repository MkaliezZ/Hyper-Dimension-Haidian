const $ = (id) => document.getElementById(id),
  node = (tag, text) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
let me,
  home,
  categories = [],
  draft = null,
  selected = null,
  parentId = null,
  page = 0,
  total = 0,
  activeAnchor = null,
  dirty = false,
  saving = false,
  cooldownUntil = 0,
  cooldownTimer;
const start = new URLSearchParams(location.search);
const stateNames = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  withdrawn: '已撤回',
  hidden: '已隐藏',
  appealed: '申诉中',
  rejected: '未通过',
};
const errors = {
  login_required: '请先登录学校账号，再为地标留言。登录后会回到当前页面。',
  school_membership_required: '请先加入当前学校，或联系学校负责人发送邀请。',
  source_scope_denied: '这篇内容不在当前社区范围，请切换到对应学校或组织。',
  draft_invalid: '标题至少 3 个字，正文至少 8 个字，请补充后再提交。',
  post_rate_limited: '论坛仍在发帖冷却期，请稍后再提交；草稿已保留。',
  moderation_denied: '当前范围需要版主权限。',
  source_write_conflict: '内容已被其他操作更新，请刷新再处理。',
  draft_write_conflict: '草稿版本已更新，请重新读取。',
  community_anchor_invalid: '请选择有效地图地点。',
  community_public_place_required: '只能关联当前学校的公开地点。',
  reason_required: '请填写至少 3 个字的操作理由。',
  community_home_conflict: '主页已被更新，请刷新后重试。',
  attachment_requires_draft: '附件只能添加到尚未提交的草稿。',
  upstream_post_rate_limited: '论坛仍在发帖冷却期，请稍后再次提交；草稿已保留。',
};
const status = (text) => {
  $('status').textContent = text;
  $('compose-status').textContent = text;
};
const root = () =>
  '/community/schools/' +
  encodeURIComponent($('school').value) +
  ($('organization').value ? '/organizations/' + encodeURIComponent($('organization').value) : '');
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    const code = typeof data.error === 'string' ? data.error : data.error?.code;
    throw Error(errors[code] || (r.status >= 500 ? '服务暂时不可用，请稍后重试。已填写的内容仍保留。' : '操作未完成，请刷新后重试；如仍有问题，请联系学校负责人。'));
  }
  return data;
}
const run = (fn) => async (event) => {
  event?.preventDefault();
  try {
    await fn();
  } catch (e) {
    status(e.message);
  }
};
const option = (value, label) => {
  const o = node('option', label);
  o.value = value;
  return o;
};
function places(select, empty) {
  select.replaceChildren(option('', empty));
  for (const p of home.places)
    select.append(option(JSON.stringify({ sceneId: p.sceneId, entityId: p.entityId }), p.label));
}
const anchor = (select) => (select.value ? JSON.parse(select.value) : null);
function resetDraft() {
  draft = null;
  parentId = null;
  dirty = false;
  $('compose-heading').textContent = activeAnchor ? '给地标留言' : '写一篇校园故事';
  $('compose').reset();
  if (activeAnchor) {
    $('place').value = JSON.stringify(activeAnchor);
    const name = home.places.find(p => p.sceneId === activeAnchor.sceneId && p.entityId === activeAnchor.entityId)?.label;
    $('title').value = name ? name + ' 的留言' : '';
  }
  $('submit-draft').textContent = activeAnchor ? '提交留言' : '提交审核';
  $('attach-form').hidden = true;
  $('draft-state').textContent = '草稿仅自己可见；提交后由当前范围版主审核。';
  $('compose-status').textContent = '';
  showCooldown();
}
function focusComposer() {
  $('composer-section').scrollIntoView({block:'start'});
  $('content').focus({preventScroll:true});
}
function showCooldown() {
  const seconds = Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));
  $('submit-draft').disabled = saving || seconds > 0;
  $('submit-draft').textContent = seconds ? seconds + ' 秒后可提交' : parentId ? '提交评论' : activeAnchor ? '提交留言' : '提交审核';
  $('posting-status').textContent = seconds ? '论坛发帖间隔还需 ' + seconds + ' 秒。可以继续填写或先保存草稿。' : '';
  if (!seconds) clearInterval(cooldownTimer);
  return seconds;
}
async function postingReady() {
  const state = await api('/m0/schools/'+encodeURIComponent($('school').value)+'/forum/posting-state');
  if (!Number.isFinite(state.retryAfterMs)) throw Error('暂时无法核对论坛提交状态，请刷新重试。');
  cooldownUntil = Date.now() + Math.max(0,state.retryAfterMs);
  clearInterval(cooldownTimer);
  if (showCooldown()>0) cooldownTimer=setInterval(showCooldown,1000);
  return cooldownUntil<=Date.now();
}
function applyPlaceContext() {
  const sceneId = start.get('sceneId'), entityId = start.get('entityId');
  const place = home.places.find(p => p.sceneId === sceneId && p.entityId === entityId);
  activeAnchor = place ? {sceneId:place.sceneId,entityId:place.entityId} : null;
  document.body.classList.toggle('landmark-mode', Boolean(place));
  $('landmark-context').hidden = !place;
  if (place) {
    $('page-heading').textContent = place.label + ' · 地点留言';
    $('landmark-title').textContent = '当前地标：' + place.label;
    $('map-filter').value = JSON.stringify(activeAnchor);
  }
  $('all-community').href = '/community.html?' + new URLSearchParams({school:$('school').value});
}
async function loadDrafts() {
  const r = await api(root() + '/drafts');
  $('drafts').replaceChildren();
  for (const d of r.items.filter(x => x.status === 'submitted')) {
    const row = node('div');row.className = 'card';
    const b = node('button', '查看已提交 · ' + d.title);
    b.onclick = run(() => showPost(d.sourceId));row.append(b);$('drafts').append(row);
  }
  for (const d of r.items.filter((x) => x.status === 'draft')) {
    const row = node('div');
    row.className = 'card';
    const b = node('button', '继续草稿 · ' + d.title);
    b.onclick = run(async () => {
      draft = d;
      dirty = false;
      parentId = d.parentId;
      $('title').value = d.title;
      $('content').value = d.content;
      $('category').value = d.categoryId || '';
      $('place').value = d.anchor ? JSON.stringify(d.anchor) : '';
      $('compose-heading').textContent = d.parentId ? '继续评论草稿' : '继续草稿';
      $('attach-form').hidden = false;
      $('draft-state').textContent =
        '草稿版本 ' + d.version + ' · 附件 ' + (d.attachmentIds?.length || 0);
      focusComposer();
    });
    row.append(b);
    $('drafts').append(row);
  }
}
async function loadList() {
  const query = new URLSearchParams({
    page: String(page),
    limit: '10',
    query: $('query').value,
    category: $('category-filter').value,
  });
  let route = '/posts';
  if ($('map-filter').value) {
    route = '/map';
    for (const [k, v] of Object.entries(anchor($('map-filter')))) query.set(k, v);
  }
  const r = await api(root() + route + '?' + query);
  total = r.total;
  $('posts').replaceChildren();
  for (const p of r.items) {
    const row = node('article');
    row.className = 'card';
    const b = node('button', p.title);
    b.onclick = run(() => showPost(p.id));
    row.append(
      b,
      node(
        'p',
        `${stateNames[p.status] || p.status} · 内容版本 ${p.revision}${p.anchor ? ' · 地图记忆' : ''}`,
      ),
    );
    $('posts').append(row);
  }
  if (!r.items.length) $('posts').append(node('p', activeAnchor ? '这里还没有已发布留言。你可以写下第一段记忆，提交后由版主审核。' : '此范围还没有符合条件的内容。'));
  $('page-info').textContent = `第 ${page + 1} 页 · ${total} 篇`;
  $('previous').disabled = page === 0;
  $('next').disabled = !r.hasMore;
}
async function loadScope() {
  home = await api(root() + '/home');
  categories = (await api(root() + '/categories')).items;
  $('home-name').textContent = home.name;
  $('home-summary').textContent = home.page.summary || '这里的社区介绍，等待负责人补充。';
  $('home-owners').textContent =
    '负责人：' + (home.owners.map((x) => x.display_name).join('、') || '尚未指定');
  $('home-anchor').textContent = home.page.anchor
    ? '地图位置：' +
      (home.places.find((x) => x.entityId === home.page.anchor.entityId)?.label ||
        home.page.anchor.entityId)
    : '';
  $('home-form').hidden = !home.canManage;
  $('home-input').value = home.page.summary;
  $('category-form').hidden = !home.canModerate;
  for (const id of ['category', 'category-filter']) {
    $(id).replaceChildren(option('', id === 'category' ? '通用板块' : '全部板块'));
    for (const c of categories) $(id).append(option(c.categoryId, c.name));
  }
  places($('place'), '不关联地点');
  places($('map-filter'), '所有地点');
  places($('home-place'), '不关联地点');
  applyPlaceContext();
  $('home-place').value = home.page.anchor ? JSON.stringify(home.page.anchor) : '';
  $('space-link').href = '/?space=' + encodeURIComponent(home.spaceId);
  $('activities-link').href = home.activityPath;
  selected = null;
  $('detail').hidden = true;
  resetDraft();
  page = 0;
  await Promise.all([loadList(), loadDrafts(), postingReady()]);
  status('已读取当前学校与组织范围。');
}
async function loadSchool() {
  const contexts = await api(
    '/community/schools/' + encodeURIComponent($('school').value) + '/contexts',
  );
  $('organization').replaceChildren();
  if (contexts.schoolAccessible) $('organization').append(option('', '全校社区'));
  for (const o of contexts.organizations) $('organization').append(option(o.org_id, o.name));
  await loadScope();
}
function actionButton(label, action, extra = {}) {
  const b = node('button', label);
  b.onclick = run(async () => {
    await api(root() + '/action', {
      requestId: crypto.randomUUID(),
      id: selected.id,
      action,
      expectedRevision: selected.revision,
      expectedWorkflowVersion: selected.workflowVersion,
      reason: $('reason').value,
      ...extra,
    });
    await showPost(selected.id);
    await loadList();
    status('操作完成，理由与状态已记录。');
  });
  return b;
}
async function showPost(id) {
  selected = await api(root() + '/post/' + encodeURIComponent(id));
  const current = new URL(location.href);
  current.searchParams.set('post',id);
  current.searchParams.set('school',$('school').value);
  if ($('organization').value) current.searchParams.set('organization',$('organization').value);
  else current.searchParams.delete('organization');
  history.replaceState(null,'',current.pathname+current.search);
  $('detail').hidden = false;
  $('detail-title').textContent = selected.title;
  $('detail-content').textContent = selected.content;
  $('detail-meta').textContent =
    `${stateNames[selected.status] || selected.status} · 内容版本 ${selected.revision}`;
  $('detail-actions').replaceChildren();
  $('reason').value = '';
  if (selected.status === 'published')
    $('detail-actions').append(actionButton('举报内容', 'report'));
  if (selected.own && ['published', 'pending'].includes(selected.sourceStatus))
    $('detail-actions').append(actionButton('撤回我的内容', 'withdraw'));
  if (selected.own && ['hidden', 'withdrawn', 'rejected'].includes(selected.status))
    $('detail-actions').append(actionButton('提交申诉', 'appeal'));
  if (selected.canModerate) {
    if (selected.sourceStatus === 'pending')
      $('detail-actions').append(
        actionButton('批准发布', 'approve'),
        actionButton('退回投稿', 'reject'),
      );
    if (selected.sourceStatus === 'published')
      $('detail-actions').append(actionButton('隐藏内容', 'hide'));
    if (selected.appeal && !selected.appeal.resolved)
      $('detail-actions').append(
        actionButton('申诉通过并恢复', 'review-appeal', { decision: 'restore' }),
        actionButton('驳回申诉', 'review-appeal', { decision: 'reject' }),
      );
    if (selected.draft)
      $('detail-actions').append(
        actionButton('批准编辑稿', 'approve-edit', { draftId: selected.draft.id }),
        actionButton('退回编辑稿', 'reject-edit', { draftId: selected.draft.id }),
      );
  }
  if (selected.sourceStatus === 'published' && (selected.own || selected.canModerate)) {
    const edit = node('button', '编辑正文（重新审核）');
    edit.onclick = run(async () => {
      const query = new URLSearchParams({school:$('school').value,org:$('organization').value,id:selected.id});
      location.href = '/forum-editor.html?' + query;
    });
    $('detail-actions').append(edit);
  }
  $('attachments').replaceChildren();
  for (const id of selected.attachmentIds || []) {
    const a = node('a', '下载附件');
    a.href =
      '/attachments/schools/' +
      encodeURIComponent($('school').value) +
      '/' +
      encodeURIComponent(id) +
      '/download';
    a.style.marginRight = '16px';
    $('attachments').append(a);
  }
  $('reports').replaceChildren();
  for (const r of selected.reports || []) {
    const card = node('div');
    card.className = 'card';
    card.append(node('p', '举报：' + r.reason + (r.resolved ? ' · 已处理' : '')));
    if (selected.canModerate && !r.resolved)
      card.append(
        actionButton('举报属实并隐藏', 'review-report', { reportId: r.id, decision: 'hide' }),
        actionButton('关闭举报', 'review-report', { reportId: r.id, decision: 'dismiss' }),
      );
    $('reports').append(card);
  }
  if (selected.appeal)
    $('reports').append(
      node(
        'p',
        '申诉：' +
          selected.appeal.reason +
          (selected.appeal.resolved ? ' · ' + selected.appeal.resolution : ''),
      ),
    );
  if (selected.draft) $('reports').append(node('pre', '待审编辑稿：\n' + selected.draft.content));
  $('trail').replaceChildren(
    ...(selected.trail || []).map((t) => node('p', `${t.at} · ${t.action} · ${t.reason}`)),
  );
  $('replies').replaceChildren();
  $('reply').hidden = selected.sourceStatus !== 'published' || Boolean(selected.parentId);
  $('parent-post').hidden = !selected.parentId;
  if (!selected.parentId && selected.sourceStatus === 'published') {
    const r = await api(root() + '/posts?parent=' + encodeURIComponent(selected.id) + '&limit=50');
    if (!r.items.length) $('replies').append(node('p', '还没有已发布的评论。'));
    for (const p of r.items) {
      const b = node('button', p.title + ' · ' + (stateNames[p.status] || p.status));
      b.onclick = run(() => showPost(p.id));
      $('replies').append(b);
    }
  }
  $('detail').scrollIntoView({block:'start'});
  $('detail-title').focus({preventScroll:true});
}
$('home-form').onsubmit = run(async () => {
  await api(root() + '/home', {
    requestId: crypto.randomUUID(),
    expectedVersion: home.page.version,
    summary: $('home-input').value,
    anchor: anchor($('home-place')),
  });
  await loadScope();
  status('社区主页已保存。');
});
$('category-form').onsubmit = run(async () => {
  await api(root() + '/categories', {
    requestId: crypto.randomUUID(),
    name: $('category-name').value,
    description: $('category-description').value,
  });
  await loadScope();
  status('板块已建立。');
});
async function saveDraft() {
  draft = await api(root() + '/drafts', {
    requestId: crypto.randomUUID(),
    draftId: draft?.draftId,
    expectedVersion: draft?.version || 0,
    title: $('title').value,
    content: $('content').value,
    categoryId: $('category').value || null,
    anchor: anchor($('place')),
    parentId,
  });
  dirty = false;
  $('attach-form').hidden = false;
  $('draft-state').textContent = '草稿已保存 · 版本 ' + draft.version;
  await loadDrafts();
  status('草稿已保存，仅自己可见。');
}
async function composeAction(submit) {
  if (saving || !$('compose').reportValidity()) return;
  saving = true;
  $('compose').setAttribute('aria-busy','true');
  $('submit-draft').disabled = $('save-draft').disabled = true;
  try {
    if (!draft || dirty || !submit) await saveDraft();
    if (submit) {
      if (!await postingReady()) {status('草稿已保存；发帖间隔结束后即可提交。');return;}
      const r = await api(root() + '/submit', {requestId:crypto.randomUUID(),draftId:draft.draftId,expectedVersion:draft.version});
      resetDraft();
      await Promise.all([loadList(),loadDrafts()]);
      await showPost(r.id);
      status('已提交审核。审核通过后会显示在当前地点；重复点击不会再提交一份。');
    }
  } finally {
    saving = false;
    $('compose').removeAttribute('aria-busy');
    $('save-draft').disabled = false;
    showCooldown();
  }
}
$('compose').onsubmit = run(() => composeAction(true));
$('save-draft').onclick = run(() => composeAction(false));
$('attach-form').onsubmit = run(async () => {
  if (!draft) return;
  const file = $('attachment-file').files[0];
  if (!file || file.size > 524288) throw Error('请选择不超过512 KiB的文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const upload = await api('/attachments/schools/' + encodeURIComponent($('school').value), {
    requestId: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || 'text/plain',
    dataBase64: btoa(binary),
    purpose: 'community',
    scopeId: $('organization').value || '',
    targetId: draft.sourceId,
  });
  draft = await api(root() + '/post/' + draft.sourceId + '/attachments', {
    requestId: crypto.randomUUID(),
    attachmentId: upload.attachmentId || upload.id,
  });
  $('draft-state').textContent =
    '草稿版本 ' + draft.version + ' · 附件 ' + draft.attachmentIds.length;
  await loadDrafts();
  status('附件已绑定草稿，按同一审核状态开放下载。');
});
$('reply').onclick = () => {
  resetDraft();
  parentId = selected.id;
  $('compose-heading').textContent = '回复：' + selected.title;
  $('title').value = '回复：' + selected.title;
  $('category').value = selected.categoryId || '';
  $('place').value = selected.anchor ? JSON.stringify(selected.anchor) : '';
  $('submit-draft').textContent = '提交评论';
  dirty = true;
  focusComposer();
};
$('parent-post').onclick = run(() => showPost(selected.parentId));
$('write-memory').onclick = () => {resetDraft();focusComposer();};
$('new-draft').onclick = resetDraft;
$('compose').oninput = () => {
  dirty = true;
  $('draft-state').textContent = '有尚未保存的修改；提交时会先保存，也可以单独保存草稿。';
};
$('refresh').onclick = run(loadScope);
$('school').onchange = run(loadSchool);
$('organization').onchange = run(loadScope);
$('search-form').onsubmit = run(async () => {
  page = 0;
  await loadList();
});
$('previous').onclick = run(async () => {
  page--;
  await loadList();
});
$('next').onclick = run(async () => {
  page++;
  await loadList();
});
window.communityQA = {
  get selected() {
    return selected;
  },
  get draft() {
    return draft;
  },
  get home() {
    return home;
  },
};
try {
  me = await api('/m0/me');
  for (const s of me.schools) $('school').append(option(s.school_id, s.name || s.school_id));
  if (me.schools.some((s) => s.school_id === start.get('school')))
    $('school').value = start.get('school');
  await loadSchool();
  if (
    start.get('organization') &&
    [...$('organization').options].some((o) => o.value === start.get('organization'))
  ) {
    $('organization').value = start.get('organization');
    await loadScope();
  }
  $('workspace').hidden = false;
  if (start.get('post')) await showPost(start.get('post'));
} catch (e) {
  $('login').hidden = false;
  status(e.message);
}
