const $ = (id) => document.getElementById(id);
const state = {
  draft: '尚未提交',
  pending: '等待审核',
  published: '已审核发布',
  rejected: '退回修改',
  cancelled: '已取消',
  registered: '报名成功',
  waitlisted: '正在候补',
  withdrawn: '已退出',
  verified: '参与已核验',
  revoked: '核验已撤销',
  accepted: '证明已采纳',
  superseded: '已有新版证明',
};
const issues = {
  membership_denied: '当前账号没有本校有效权限。',
  organization_denied: '当前组织权限已失效。',
  school_owner_required: '需要学校负责人权限。',
  organization_owner_required: '需要本组织负责人权限。',
  moderation_denied: '需要本范围审核权限。',
  revision_conflict: '记录已更新，请刷新后核对最新版本。',
  request_conflict: '同一次操作的内容发生变化，请先核对已保存结果。',
  registration_closed: '活动已停止报名。',
  already_registered: '你已经报名，请查看本人的参与记录。',
  task_choice_required: '请选择一项本活动的志愿分工。',
  designated_verifier_required: '只有本活动当前指定核验者可以处理。',
  self_verification_denied: '核验者不能批准或撤销本人的参与记录。',
  verification_not_open: '这条记录尚不满足核验条件，或已完成核验。',
  evidence_not_open: '正式报名后且活动开始后，才能提交参与证明。',
  evidence_already_reviewed: '这份证明已有处理结果，请刷新。',
  verified_minutes_invalid: '请填写真实且不超过本次活动时长的分钟数。',
  attachment_validation_not_connected: '受控附件存储尚未接入，请先提交文字说明。',
  attachment_missing: '附件已不存在，请重新核对证明。',
  attachment_scope_denied: '当前不能读取这份附件。',
  draft_or_rejected_edit_only:
    '已提交或已发布的安排不可直接改写。可取消并重新建立，以保留参与者收到的原安排。',
  activity_state_conflict: '活动状态已变化，请刷新后再操作。',
  participation_state_conflict: '此参与记录已结束或已核验，不能直接退出。',
  activity_time_invalid: '请核对开始、结束与报名截止时间。',
  activity_not_started: '活动开始后才能发布回顾。',
  volunteer_tasks_required: '志愿活动至少需要一项明确分工。',
  verifiers_invalid: '请至少指定一位当前有权限的核验者。',
};
let me,
  items = [],
  records = [],
  organizations = [],
  current,
  mode = 'explore',
  epoch = 0,
  editing,
  proofRecord,
  decide,
  config = {};
let busyCount = 0;
const attempts = new Map();
const uploads = new Map();
const school = () => $('school').value,
  base = () => '/activities/schools/' + encodeURIComponent(school());
const localDate = (v) => {
  const d = new Date(v);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const when = (v) => new Date(v).toLocaleString('zh-CN', { hour12: false });
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function message(text, bad = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', bad);
}
async function request(path, body) {
  let r;
  try {
    r = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw Object.assign(Error('连接中断，尚未确认结果。请保留原内容重试同一次操作。'), {
      uncertain: true,
    });
  }
  let v;
  try {
    v = await r.json();
  } catch {
    throw Object.assign(Error('没有收到可核对的响应，请更新记录。'), { uncertain: true });
  }
  if (!r.ok) {
    const code = v.error?.code || v.error?.message || 'unknown';
    throw Object.assign(Error(issues[code] || `未完成操作（${code}），请核对输入。`), {
      status: r.status,
      uncertain: r.status >= 500,
    });
  }
  return v;
}
async function write(path, body, operation = path) {
  const fingerprint = JSON.stringify(body),
    old = attempts.get(operation);
  if (old && old.fingerprint !== fingerprint)
    throw Error('上次提交结果未确认，请保留原内容重试或先刷新核对。');
  const a = old || { requestId: crypto.randomUUID(), fingerprint };
  attempts.set(operation, a);
  try {
    const v = await request(path, { requestId: a.requestId, ...body });
    attempts.delete(operation);
    return v;
  } catch (e) {
    if (!e.uncertain) attempts.delete(operation);
    throw e;
  }
}
function perform(fn) {
  return async (event) => {
    event?.preventDefault();
    const n = event?.currentTarget;
    if (n?.dataset.busy) return;
    if (n) n.dataset.busy = 'true';
    const buttons =
      n?.tagName === 'FORM'
        ? [...n.querySelectorAll('button')]
        : n?.tagName === 'BUTTON'
          ? [n]
          : [];
    buttons.forEach((b) => (b.disabled = true));
    busyCount++;
    $('school').disabled = true;
    document.querySelectorAll('.dialog-error').forEach((n) => n.remove());
    try {
      await fn(event);
    } catch (e) {
      message(e.message, true);
      const d = document.querySelector('dialog[open]');
      if (d) {
        const m = el('p', e.message, 'notice dialog-error');
        m.setAttribute('role', 'alert');
        d.append(m);
      }
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      if (n) delete n.dataset.busy;
      busyCount--;
      $('school').disabled = busyCount > 0;
    }
  };
}
function button(label, fn, cls = '') {
  const b = el('button', label, cls);
  b.type = 'button';
  b.onclick = perform(fn);
  return b;
}
function badge(s) {
  const b = el('span', state[s] || s, 'badge');
  b.dataset.state = s;
  return b;
}
function card(title, status, body) {
  const a = el('article', null, 'card');
  a.append(badge(status), el('h3', title));
  if (body) a.append(el('p', body, 'description'));
  return a;
}
function empty(n, text) {
  n.replaceChildren(el('p', text, 'empty'));
}
function tab(name) {
  mode = name;
  for (const x of ['explore', 'mine', 'manage']) {
    $(x + '-panel').hidden = x !== name;
    $('tab-' + x).setAttribute('aria-selected', String(x === name));
  }
  $('detail').hidden = true;
}
function decision(title, note, fn, minutes = null) {
  decide = fn;
  $('decision-title').textContent = title;
  $('decision-note').textContent = note;
  $('decision-reason').value = '';
  $('minutes-label').hidden = minutes === null;
  $('decision-minutes').value = minutes ?? 0;
  $('decision-dialog').showModal();
}
function activityCard(a) {
  const n = card(a.title, a.status, a.description);
  n.dataset.activityId = a.activityId;
  n.append(
    el('p', (a.kind === 'volunteer' ? '志愿任务' : '校园活动') + ' · ' + when(a.startsAt), 'meta'),
    el('p', `正式名额 ${a.capacity} · 截止 ${when(a.registrationClosesAt)}`, 'meta'),
  );
  const buttons = el('div', null, 'actions');
  buttons.append(button('查看安排与参与', () => show(a.activityId), 'primary'));
  n.append(buttons);
  return n;
}
function renderItems() {
  const term = $('search').value.trim().toLowerCase(),
    kind = $('kind-filter').value,
    org = $('org-filter').value;
  const visible = items.filter(
    (a) =>
      a.status === 'published' &&
      (!kind || a.kind === kind) &&
      (!org || a.orgId === org) &&
      (a.title + ' ' + a.description).toLowerCase().includes(term),
  );
  if (visible.length) $('activities').replaceChildren(...visible.map(activityCard));
  else empty($('activities'), '当前没有匹配的已审核活动。可以换个关键词，或稍后回来看看。');
  const managed = items.filter(
    (a) => (!org || a.orgId === org) && (a.canManage || a.canReview || a.canVerify),
  );
  if (managed.length) $('managed').replaceChildren(...managed.map(activityCard));
  else empty($('managed'), '目前没有你负责、审核或核验的活动。建立活动需要学校或组织负责人权限。');
}
async function refresh() {
  const at = epoch,
    v = await request(base() + '/items');
  if (at !== epoch) return;
  items = v.items;
  renderItems();
}
function submission(n, s) {
  const p = el('section', null, 'proof');
  p.append(badge(s.status), el('p', s.note));
  if (s.reason) p.append(el('p', '处理依据：' + s.reason, 'muted'));
  for (const a of s.attachments || []) {
    const link = el('a', '下载凭据：' + a.name);
    link.href =
      '/attachments/schools/' +
      encodeURIComponent(school()) +
      '/' +
      encodeURIComponent(a.attachmentId) +
      '/download';
    p.append(link);
  }
  n.append(p);
}
function recordCard(r, title = r.title) {
  const n = card(title || '活动参与', r.status, `报名时间：${when(r.createdAt)}`);
  n.dataset.registrationId = r.registrationId;
  if (r.taskId)
    n.append(
      el(
        'p',
        '所选分工：' + (current?.tasks.find((t) => t.id === r.taskId)?.title || r.taskId),
        'meta',
      ),
    );
  if (r.verifiedAt)
    n.append(el('p', `核验记录：${r.verifiedMinutes || 0} 分钟 · ${when(r.verifiedAt)}`, 'meta'));
  if (r.revokeReason) n.append(el('p', '撤销依据：' + r.revokeReason, 'meta'));
  if (r.submissions?.length) {
    const d = document.createElement('details');
    d.append(el('summary', '查看证明与处理记录'));
    for (const s of r.submissions) submission(d, s);
    n.append(d);
  }
  const actions = el('div', null, 'actions');
  actions.append(button('查看活动', () => show(r.activityId)));
  if (['registered', 'waitlisted'].includes(r.status)) {
    actions.append(
      button('退出报名', () =>
        decision('退出这次报名', '退出会让出名额；候补者按报名顺序递补。', async (reason) => {
          await write(base() + '/registrations/' + r.registrationId + '/withdraw', {
            expectedRevision: r.revision,
            reason,
          });
          await loadMine();
          if (current?.activityId === r.activityId) await show(r.activityId);
          message('已退出报名，名额按规则递补。');
        }),
      ),
    );
  }
  if (r.status === 'registered')
    actions.append(button('补充参与证明', () => openEvidence(r), 'primary'));
  n.append(actions);
  return n;
}
async function loadMine() {
  const at = epoch,
    v = await request(base() + '/registrations');
  if (at !== epoch) return;
  records = v.records;
  if (records.length) $('my-records').replaceChildren(...records.map((r) => recordCard(r)));
  else empty($('my-records'), '还没有参与记录。到“发现活动”选择一个你想参加的活动。');
}
async function show(id) {
  const at = epoch,
    a = await request(base() + '/items/' + id);
  if (at !== epoch) return;
  current = a;
  $('detail').hidden = false;
  $('detail-kind').textContent =
    a.kind === 'volunteer' ? 'VOLUNTEER / 志愿分工' : 'CAMPUS EVENT / 校园活动';
  $('detail-title').textContent = a.title;
  $('detail-description').textContent = a.description;
  $('detail-status').textContent = state[a.status];
  $('detail-status').dataset.state = a.status;
  const count = (k) => a.counts.find((c) => c.status === k)?.count || 0;
  $('detail-facts').replaceChildren(
    ...[
      ['活动时间', when(a.startsAt) + ' 至 ' + when(a.endsAt)],
      ['报名截止', when(a.registrationClosesAt)],
      [
        '容量状态',
        `${count('registered') + count('verified')} / ${a.capacity} 已占用 · ${count('waitlisted')} 人候补`,
      ],
      ['参与条件', a.conditions],
      ['提醒安排', '提前 ' + a.remindBeforeMinutes + ' 分钟发送至本人的收件箱'],
    ].flatMap(([k, v]) => [el('dt', k), el('dd', v)]),
  );
  $('location-link').hidden = !a.sceneId;
  if (a.sceneId)
    $('location-link').href =
      '/?space=' +
      encodeURIComponent(school()) +
      '&scene=' +
      encodeURIComponent(a.sceneId) +
      '&entity=' +
      encodeURIComponent(a.entityId);
  $('task-section').hidden = !a.tasks.length;
  $('task-list').replaceChildren(
    ...a.tasks.map((t) => {
      const n = el('article');
      n.append(el('h4', t.title), el('p', t.description));
      return n;
    }),
  );
  $('join-task').replaceChildren(...a.tasks.map((t) => new Option(t.title, t.id)));
  $('join-task-label').hidden = a.kind !== 'volunteer';
  const joinable =
    a.status === 'published' &&
    new Date(a.registrationClosesAt) > new Date() &&
    (!a.registration || a.registration.status === 'withdrawn');
  $('join-section').hidden = !joinable;
  $('join-note').textContent =
    count('registered') + count('verified') >= a.capacity
      ? '正式名额已满。报名后进入候补，收到递补通知后再参加。'
      : '报名成功后会保留正式名额。无法参加时请及时退出。';
  $('own-participation').hidden = !a.registration;
  if (a.registration) $('own-participation').replaceChildren(recordCard(a.registration, a.title));
  $('recap-section').hidden = !a.recap;
  $('recap-text').textContent = a.recap || '';
  $('activity-actions').replaceChildren();
  const actions = $('activity-actions');
  if (a.canManage && ['draft', 'rejected'].includes(a.status)) {
    actions.append(
      button('编辑草稿', () => edit(a)),
      button(
        '提交学校审核',
        async () => {
          await write(base() + '/items/' + id + '/submit', { expectedRevision: a.revision });
          await refresh();
          await show(id);
          message('草稿已提交审核，尚未公开。');
        },
        'primary',
      ),
    );
  }
  if (a.canReview && a.status === 'pending') {
    for (const [d, title] of [
      ['publish', '审核发布'],
      ['reject', '退回修改'],
    ])
      actions.append(
        button(
          title,
          () =>
            decision(
              title,
              '请核对资料、容量、时间与核验者身份，处理依据会留存。',
              async (reason) => {
                await write(base() + '/items/' + id + '/review', {
                  expectedRevision: a.revision,
                  decision: d,
                  reason,
                });
                await refresh();
                await show(id);
                message('活动审核结果已记录。');
              },
            ),
          d === 'publish' ? 'primary' : '',
        ),
      );
  }
  if (a.canManage && a.status !== 'cancelled')
    actions.append(
      button(
        '取消活动',
        () =>
          decision(
            '取消活动并通知参与者',
            '报名和候补会取消；已核验的参与记录会保留原始依据并冲正。',
            async (reason) => {
              await write(base() + '/items/' + id + '/cancel', {
                expectedRevision: a.revision,
                reason,
              });
              await refresh();
              await loadMine();
              await show(id);
              message('活动已取消，参与记录与原因保留。');
            },
          ),
        'danger',
      ),
    );
  if (a.canManage && a.status === 'published' && new Date(a.startsAt) <= new Date())
    actions.append(
      button('发布活动回顾', () =>
        decision(
          '发布活动回顾',
          '只写可供本范围公开的复盘，不复制私人证明或联系方式。',
          async (recap) => {
            await write(base() + '/items/' + id + '/recap', {
              expectedRevision: a.revision,
              recap,
            });
            await refresh();
            await show(id);
            message('活动回顾已更新。');
          },
        ),
      ),
    );
  $('participants-section').hidden = !(a.canManage || a.canVerify);
  if (a.canManage || a.canVerify) await participants();
}
async function participants() {
  const a = current,
    at = epoch,
    v = await request(base() + '/items/' + a.activityId + '/participants');
  if (at !== epoch || current?.activityId !== a.activityId) return;
  if (!v.participants.length) return empty($('participants'), '目前还没有报名。');
  $('participants').replaceChildren(
    ...v.participants.map((r) => {
      const n = card(
        r.displayName || '学校成员',
        r.status,
        `分工：${a.tasks.find((t) => t.id === r.taskId)?.title || '活动参与'}\n报名时间：${when(r.createdAt)}`,
      );
      n.dataset.registrationId = r.registrationId;
      if (r.verifiedAt) n.append(el('p', `核验 ${r.verifiedMinutes} 分钟 · ${when(r.verifiedAt)}`));
      for (const s of r.submissions || []) submission(n, s);
      const controls = el('div', null, 'actions');
      if (a.canVerify && r.userId !== me.userId) {
        if (r.status === 'registered' && r.submissions?.some((s) => s.status === 'pending'))
          for (const [decisionValue, title] of [
            ['approve', '确认参与'],
            ['reject', '退回补充'],
          ])
            controls.append(
              button(
                title,
                () =>
                  decision(
                    title,
                    '核对可追溯的参与依据，个人自述不等于已发生服务；这次操作会写入处理记录。',
                    async (reason, minutes) => {
                      await write(base() + '/registrations/' + r.registrationId + '/verify', {
                        expectedRevision: r.revision,
                        decision: decisionValue,
                        reason,
                        ...(decisionValue === 'approve' ? { minutes } : {}),
                      });
                      await participants();
                      message('核验决定已记录。');
                    },
                    decisionValue === 'approve' ? (a.kind === 'volunteer' ? 1 : 0) : null,
                  ),
                decisionValue === 'approve' ? 'primary' : '',
              ),
            );
        if (r.status === 'verified')
          controls.append(
            button(
              '撤销核验',
              () =>
                decision(
                  '撤销核验并保留原记录',
                  '撤销会产生可追溯冲正流水，不会删除原证明。',
                  async (reason) => {
                    await write(base() + '/registrations/' + r.registrationId + '/revoke', {
                      expectedRevision: r.revision,
                      reason,
                    });
                    await show(a.activityId);
                    message('核验已撤销，历史依据仍保留。');
                  },
                ),
              'danger',
            ),
          );
      } else if (a.canVerify && r.userId === me.userId)
        n.append(el('p', '本人参与须由另一位指定核验者处理。', 'muted'));
      n.append(controls);
      return n;
    }),
  );
}
async function loadCandidates(selected = []) {
  $('verifier-options').replaceChildren();
  try {
    const v = await request(
      base() +
        '/setup' +
        ($('edit-org').value ? '?orgId=' + encodeURIComponent($('edit-org').value) : ''),
    );
    $('scope-note').textContent = '所选范围的负责人可以保存草稿。';
    $('save-draft').disabled = false;
    $('verifier-options').replaceChildren(
      ...v.candidates.map((u) => {
        const label = el('label'),
          input = document.createElement('input');
        input.type = 'checkbox';
        input.value = u.userId;
        input.checked = selected.includes(u.userId);
        label.append(input, document.createTextNode(u.displayName));
        return label;
      }),
    );
  } catch (e) {
    if (e.status !== 403) throw e;
    $('scope-note').textContent = '你没有此范围的活动管理权限，请选择自己负责的组织。';
    $('save-draft').disabled = true;
  }
}
async function edit(a = null) {
  editing = a;
  $('edit-form').reset();
  $('edit-id').value = a?.activityId || '';
  $('edit-heading').textContent = a ? '修改草稿' : '新建活动草稿';
  $('edit-org').replaceChildren(
    new Option('全校活动', ''),
    ...organizations.map((o) => new Option(o.name, o.org_id)),
  );
  $('edit-org').value = a?.orgId || '';
  $('edit-org').disabled = Boolean(a);
  $('edit-kind').value = a?.kind || 'event';
  for (const [field, key] of [
    ['title', 'title'],
    ['description', 'description'],
    ['conditions', 'conditions'],
    ['capacity', 'capacity'],
    ['remind', 'remindBeforeMinutes'],
    ['scene', 'sceneId'],
    ['entity', 'entityId'],
  ])
    if (a) $('edit-' + field).value = a[key] ?? '';
  $('edit-start').value = localDate(a?.startsAt || Date.now() + 86400000);
  $('edit-end').value = localDate(a?.endsAt || Date.now() + 90000000);
  $('edit-close').value = localDate(a?.registrationClosesAt || Date.now() + 82800000);
  $('edit-tasks').value = a?.tasks.map((t) => t.title + ' | ' + t.description).join('\n') || '';
  await loadCandidates(a?.verifierIds || []);
  $('edit-dialog').showModal();
}
function openEvidence(r) {
  proofRecord = r;
  $('evidence-form').reset();
  $('evidence-title').textContent = r.title || current?.title || '本次参与';
  $('evidence-files').disabled = !config.attachmentValidationConnected;
  $('evidence-upload-note').textContent = config.attachmentValidationConnected
    ? '支持 PNG、JPEG、PDF 和 UTF-8 文本。附件仅供当前获准核验者下载。'
    : '附件存储未连接；可先提交文字说明，等待核验者核查。';
  $('evidence-dialog').showModal();
}
async function loadSchool() {
  epoch++;
  $('workspace').hidden = true;
  $('detail').hidden = true;
  current = null;
  items = [];
  records = [];
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  if (window.activitiesQA) window.activitiesQA.ready = false;
  const [status, orgs] = await Promise.all([
    request(base() + '/status'),
    request('/m1/schools/' + encodeURIComponent(school()) + '/organizations'),
  ]);
  config = status;
  organizations = orgs.organizations;
  $('org-filter').replaceChildren(
    new Option('所有获准范围', ''),
    ...organizations.map((o) => new Option(o.name, o.org_id)),
  );
  $('integration-note').textContent =
    (status.contributionConnected
      ? '核验通过后按当前学校规则写入贡献流水。'
      : '贡献规则尚未接通：本页保留核验事件，当前不会自动加分。') +
    ' ' +
    (status.scheduledQueueConnected
      ? '到期提醒由后台队列处理。'
      : '提醒已持久保存，需部署对账调度才能自动发送。');
  await Promise.all([refresh(), loadMine()]);
  $('workspace').hidden = false;
  window.activitiesQA = { ready: true, school: school() };
  message('活动、报名和核验均按当前学校及组织权限处理。');
}
for (const n of document.querySelectorAll('[data-panel]'))
  n.onclick = perform(async () => {
    tab(n.dataset.panel);
    if (mode === 'mine') await loadMine();
    else await refresh();
  });
for (const n of document.querySelectorAll('[data-close]'))
  n.onclick = () => n.closest('dialog').close();
$('school').onchange = perform(loadSchool);
$('search').oninput = renderItems;
$('kind-filter').onchange = renderItems;
$('org-filter').onchange = renderItems;
$('refresh').onclick = perform(refresh);
$('refresh-mine').onclick = perform(loadMine);
$('new-activity').onclick = perform(() => edit());
$('edit-org').onchange = perform(() => loadCandidates());
$('close-detail').onclick = () => {
  $('detail').hidden = true;
};
$('refresh-participants').onclick = perform(participants);
$('join').onclick = perform(async () => {
  const r = await write(
    base() + '/items/' + current.activityId + '/join',
    current.kind === 'volunteer' ? { taskId: $('join-task').value } : {},
  );
  await show(current.activityId);
  await loadMine();
  message(
    r.status === 'waitlisted'
      ? '已进入候补，正式递补会通知你。'
      : '报名成功，无法参加时请及时退出。',
  );
});
$('decision-form').onsubmit = perform(async () => {
  await decide($('decision-reason').value.trim(), Number($('decision-minutes').value));
  $('decision-dialog').close();
});
$('edit-form').onsubmit = perform(async () => {
  const tasks = $('edit-tasks')
    .value.split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [title, ...parts] = line.split('|');
      if (!title.trim() || !parts.join('|').trim())
        throw Error('每项分工请写成“任务名称 | 具体说明”。');
      return {
        id: editing?.tasks[i]?.id || 'task-' + (i + 1),
        title: title.trim(),
        description: parts.join('|').trim(),
      };
    });
  const data = {
    kind: $('edit-kind').value,
    orgId: $('edit-org').value || null,
    title: $('edit-title').value.trim(),
    description: $('edit-description').value.trim(),
    conditions: $('edit-conditions').value.trim(),
    startsAt: new Date($('edit-start').value).toISOString(),
    endsAt: new Date($('edit-end').value).toISOString(),
    registrationClosesAt: new Date($('edit-close').value).toISOString(),
    capacity: Number($('edit-capacity').value),
    remindBeforeMinutes: Number($('edit-remind').value),
    sceneId: $('edit-scene').value || null,
    entityId: $('edit-entity').value || null,
    tasks,
    verifierIds: [...$('verifier-options').querySelectorAll('input:checked')].map((n) => n.value),
    ...(editing ? { expectedRevision: editing.revision } : {}),
  };
  const a = await write(
    base() + '/items' + (editing ? '/' + editing.activityId + '/edit' : ''),
    data,
  );
  $('edit-dialog').close();
  tab('manage');
  await refresh();
  await show(a.activityId);
  message('草稿已保存。核对后提交审核，通过后才对本范围成员开放。');
});
$('evidence-form').onsubmit = perform(async () => {
  const files = [...$('evidence-files').files];
  if (files.length > 10 || files.some((f) => f.size > 512 * 1024))
    throw Error('最多 10 个附件，单个不能超过 512 KiB。');
  const ids = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const uploadKey = [school(), me.userId, proofRecord.activityId, f.name, digest].join(':');
    if (uploads.has(uploadKey)) {
      ids.push(uploads.get(uploadKey));
      continue;
    }
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192)
      binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    const mimeType =
      f.type ||
      {
        txt: 'text/plain',
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
      }[f.name.split('.').at(-1).toLowerCase()];
    const r = await write(
      '/attachments/schools/' + encodeURIComponent(school()),
      {
        name: f.name,
        mimeType,
        dataBase64: btoa(binary),
        purpose: 'activity-evidence',
        targetId: proofRecord.activityId,
        scopeId:
          proofRecord.orgId ||
          (current?.activityId === proofRecord.activityId ? current.orgId : null) ||
          '',
      },
      'upload:' + uploadKey,
    );
    uploads.set(uploadKey, r.attachmentId);
    ids.push(r.attachmentId);
  }
  await write(base() + '/registrations/' + proofRecord.registrationId + '/evidence', {
    expectedRevision: proofRecord.revision,
    note: $('evidence-note').value.trim(),
    attachmentIds: ids,
  });
  $('evidence-dialog').close();
  await loadMine();
  if (current?.activityId === proofRecord.activityId) await show(current.activityId);
  message('证明已提交，等待指定核验者处理。提交本身不会自动加分。');
});
try {
  me = await request('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  if (!me.extensions?.includes('activities')) {
    $('disabled').hidden = false;
    message('当前版本未启用活动模块。');
  } else if (!me.schools.length) message('请先加入学校再参加活动。');
  else {
    const link = new URLSearchParams(location.search),
      requestedSchool = link.get('school'),
      requestedOrg = link.get('organization'),
      requestedActivity = link.get('activity');
    if (requestedSchool && !me.schools.some((s) => s.school_id === requestedSchool))
      throw Error('当前账号没有链接所指学校的访问权限，请选择已加入的学校。');
    if (requestedSchool) $('school').value = requestedSchool;
    await loadSchool();
    if (requestedOrg) {
      if (!organizations.some((o) => o.org_id === requestedOrg))
        throw Error('当前账号没有链接所指组织的访问权限。');
      $('org-filter').value = requestedOrg;
      renderItems();
    }
    if (requestedActivity) {
      if (!/^[a-f0-9-]{36}$/i.test(requestedActivity)) throw Error('活动链接编号无效。');
      await show(requestedActivity);
      if (requestedOrg && current.orgId !== requestedOrg) {
        $('detail').hidden = true;
        throw Error('活动不属于链接指定的组织，请核对来源。');
      }
    }
  }
} catch (e) {
  if (e.status === 401) {
    $('login').hidden = false;
    message('请先登录学校账号。');
  } else message(e.message, true);
}
