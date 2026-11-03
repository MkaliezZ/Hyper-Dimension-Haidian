const $ = (id) => document.getElementById(id),
  node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
const names = {
    badge: '社区徽章',
    appearance: '人物绶带',
    activity: '活动准入',
    partner: '合作权益',
  },
  states = {
    draft: '草稿',
    pending: '待审核',
    published: '已发布',
    rejected: '已退回',
    withdrawn: '停止新增领取',
    reserved: '已保留份额',
    failed: '发放失败，等待重试',
    fulfilled: '已实际发放',
    revoked: '已撤销',
    expired: '已到期',
  };
let me,
  items = [],
  claims = [],
  managedClaims = [],
  orgs = [],
  targets = [],
  mode = 'explore',
  editing = null,
  action = null,
  capability = {},
  historyClaim = null,
  busy = false;
const pending = new Map(),
  school = () => $('school').value,
  base = () => '/rewards/schools/' + encodeURIComponent(school());
function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
async function request(path, body) {
  const r = await fetch(path, {
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok) {
    const code =
      data.error?.code || data.code || (typeof data.error === 'string' ? data.error : 'unknown');
    const descriptions = {
      reward_participation_membership_required:
        '本人尚未加入该组织，请先通过正式成员流程加入；本次未占用奖励份额。',
      reward_eligibility_denied: '当前贡献尚未满足本奖励条件。',
      reward_sold_out: '本轮份额已分配，请查看其他奖励。',
      reward_already_claimed: '你已领取过本轮奖励，请查看原领取记录。',
      reward_unavailable: '奖励尚未开放、已停止领取或已到期，请刷新核对。',
      reward_partner_already_redeemed: '合作凭证已经核销，需要按实际履约流程处理，不能直接撤回。',
      organization_owner_required: '需要该组织负责人权限。',
      school_owner_required: '需要学校负责人权限。',
      membership_denied: '当前学校成员权限已失效。',
      organization_denied: '当前组织权限已失效。',
      revision_conflict: '记录已更新，请刷新后核对最新版本。',
      request_conflict: '同一次请求的内容已改变，请先核对处理结果。',
    };
    throw Object.assign(Error(descriptions[code] || `操作未完成（${code}），请核对条件或刷新。`), {
      status: r.status,
    });
  }
  return data;
}
async function write(path, body) {
  const key = path,
    fingerprint = JSON.stringify(body);
  let record = pending.get(key);
  if (record && record.fingerprint !== fingerprint)
    throw Error('上一次操作结果尚未确认，请先用相同内容重试。');
  if (!record) {
    record = { fingerprint, requestId: crypto.randomUUID() };
    pending.set(key, record);
  }
  try {
    const r = await request(path, { requestId: record.requestId, ...body });
    pending.delete(key);
    return r;
  } catch (e) {
    if (e.status && e.status < 500) pending.delete(key);
    throw e;
  }
}
function perform(fn) {
  return async (e) => {
    e?.preventDefault();
    if (busy) return;
    busy = true;
    $('school').disabled = true;
    const controls = [
      ...(e?.target?.closest?.('form')?.querySelectorAll('button,input,select,textarea') || []),
    ];
    const prior = controls.map((x) => x.disabled);
    controls.forEach((x) => (x.disabled = true));
    try {
      await fn(e);
    } catch (err) {
      message(err.message, true);
      const d = document.querySelector('dialog[open]');
      if (d) {
        let p = d.querySelector('.action-error');
        if (!p) {
          p = node('p');
          p.className = 'action-error error';
          d.querySelector('form').append(p);
        }
        p.textContent = err.message;
      }
    } finally {
      controls.forEach((x, i) => (x.disabled = prior[i]));
      $('school').disabled = false;
      busy = false;
    }
  };
}
function button(text, fn, cls = '') {
  const b = node('button', text);
  b.type = 'button';
  b.className = cls;
  b.onclick = perform(fn);
  return b;
}
function badge(text) {
  const p = node('span', text);
  p.className = 'reward-status';
  return p;
}
const fmt = (v) => new Date(v).toLocaleString();
function switchTab(next) {
  mode = next;
  for (const key of ['explore', 'mine', 'manage']) {
    $(key + '-panel').hidden = next !== key;
    $('tab-' + key).setAttribute('aria-selected', next === key);
  }
}
function startAction(kind, r) {
  action = { kind, row: r };
  $('action-title').textContent = {
    claim: '确认领取 ' + r.title,
    review: '审核发布 ' + r.title,
    reject: '退回奖励草稿',
    withdraw: '停止新增领取',
    revoke: '撤销这次奖励',
  }[kind];
  $('action-note').textContent =
    kind === 'claim'
      ? `${names[r.kind]} · ${r.description}\n有效期至 ${fmt(r.expiresAt)}。本范围最低贡献 ${r.minimumContribution}，每人一次，领取不扣历史贡献。`
      : kind === 'review'
        ? `你将批准${r.demonstration ? '演示' : '正式'}奖励。总份数 ${r.stock}，到期 ${fmt(r.expiresAt)}。发布后原规则保留；请确认具有发放权限和所需资源。`
        : kind === 'withdraw'
          ? '停止未来领取，保留此前已发出的权益；需要撤销已发权益时逐条处理。'
          : kind === 'revoke'
            ? '仅撤销本次权威发放并保留原记录。已核销的合作权益无法在此伪造退回。'
            : '请说明需要补充或纠正的内容。';
  if (kind === 'claim' && r.orgId && ['appearance', 'activity', 'partner'].includes(r.kind))
    $('action-note').textContent +=
      '\n本组织资格要求本人当前已加入该组织；拥有管理权不会自动获得参与资格。';
  $('reason-label').hidden = kind === 'claim';
  $('action-reason').required = kind !== 'claim';
  $('action-reason').value = '';
  $('terms-label').hidden = !['claim', 'review'].includes(kind);
  $('demo-label').hidden = !r.demonstration || !['claim', 'review'].includes(kind);
  $('action-terms').checked = false;
  $('action-demo').checked = false;
  document.querySelectorAll('.action-error').forEach((n) => n.remove());
  $('action-dialog').showModal();
}
function itemCard(r, manage) {
  const a = node('article');
  a.className = 'card';
  a.dataset.rewardId = r.rewardId;
  a.append(badge(states[r.status]), node('h3', r.title));
  if (r.demonstration) {
    const d = badge('演示奖励');
    d.classList.add('demo');
    a.append(d);
  }
  a.append(
    node('p', r.description),
    node(
      'p',
      `${names[r.kind]} · 最低贡献 ${r.minimumContribution} · ${r.contributionPeriod || '累计'} · ${r.orgId || '全校范围'}`,
    ),
    node('p', `剩余 ${Math.max(0, r.stock - r.allocated)} / ${r.stock} 份 · 每人一次`),
    node('p', `${fmt(r.startsAt)} 至 ${fmt(r.expiresAt)}`),
  );
  const controls = node('div');
  controls.className = 'actions';
  if (manage) {
    if (['draft', 'rejected'].includes(r.status)) {
      controls.append(
        button('编辑草稿', () => edit(r)),
        button('提交审核', async () => {
          await write(base() + '/items/' + r.rewardId + '/submit', {
            expectedRevision: r.revision,
          });
          await refresh();
          message('奖励草稿已提交审核。');
        }),
      );
    }
    if (r.status === 'pending')
      controls.append(
        button('审核发布', () => startAction('review', r), 'primary'),
        button('退回', () => startAction('reject', r)),
      );
    if (r.status !== 'withdrawn')
      controls.append(button('停止领取', () => startAction('withdraw', r)));
  } else {
    const c = claims.find((c) => c.rewardId === r.rewardId);
    if (c) controls.append(node('p', '领取记录：' + states[c.effectiveStatus]));
    else if (
      r.orgId &&
      ['appearance', 'activity', 'partner'].includes(r.kind) &&
      !capability.participationOrgIds?.includes(r.orgId)
    )
      controls.append(
        node(
          'p',
          '领取和使用本组织资格前，请先由负责人按成员流程确认加入。管理权限不自动赋予参与资格。',
        ),
      );
    else if (r.available)
      controls.append(button('了解条件并领取', () => startAction('claim', r), 'primary'));
    else
      controls.append(
        node('p', r.allocated >= r.stock ? '本轮份额已分配。' : '当前尚未开放或已到期。'),
      );
  }
  a.append(controls);
  return a;
}
async function history(c, scroll = true) {
  const x = await request(base() + '/claims/' + c.claimId + '/history');
  historyClaim = c;
  $('history-events').replaceChildren(
    ...x.events.map((e) =>
      node(
        'li',
        `${fmt(e.createdAt)} · ${states[e.kind] || e.kind}${e.detail.reason ? ' · ' + e.detail.reason : ''}${e.detail.error ? ' · ' + e.detail.error : ''}`,
      ),
    ),
  );
  $('history').hidden = false;
  if (scroll) $('history').scrollIntoView({ behavior: 'smooth' });
}
function claimCard(c, manage) {
  const a = node('article');
  a.className = 'card';
  a.dataset.claimId = c.claimId;
  a.append(
    badge(states[c.effectiveStatus || c.status]),
    node('h3', c.title || c.terms.title),
    node('p', `${names[c.kind || c.terms.kind]} · 到期 ${fmt(c.expiresAt)}`),
  );
  if (c.terms.demonstration) a.append(node('p', '演示奖励，不代表真实校园或商户承诺。'));
  a.append(
    node('p', c.authorityReceipt ? '已有实际权威发放回执。' : '尚未实际发放；保留原份额等待处理。'),
  );
  if (c.lastError) a.append(node('p', '失败原因：' + c.lastError));
  if (c.revokeReason) a.append(node('p', '处理理由：' + c.revokeReason));
  const ref = node('p', '记录编号：' + c.claimId);
  ref.className = 'claim-meta';
  a.append(ref);
  const controls = node('div');
  controls.className = 'actions';
  controls.append(button('查看处理轨迹', () => history(c)));
  if (!manage && c.status === 'failed')
    controls.append(
      button('重试原领取', async () => {
        const x = await write(base() + '/claims/' + c.claimId + '/retry', {
          expectedRevision: c.revision,
        });
        await refresh();
        message(
          x.status === 'fulfilled' ? '原奖励已实际发放。' : '仍未发放，原份额已保留。',
          x.status !== 'fulfilled',
        );
      }),
    );
  if (manage && ['fulfilled', 'failed'].includes(c.status))
    controls.append(button('撤销发放', () => startAction('revoke', c)));
  if (!manage && c.status === 'fulfilled') {
    const link = node(
      'a',
      c.terms.kind === 'badge'
        ? '查看个人徽章'
        : c.terms.kind === 'partner'
          ? '查看合作凭证'
          : c.terms.kind === 'activity'
            ? '前往活动'
            : '前往形象与背包',
    );
    link.href =
      c.terms.kind === 'badge'
        ? '/profile.html'
        : c.terms.kind === 'partner'
          ? '/partners.html'
          : c.terms.kind === 'activity'
            ? '/activities.html'
            : '/m2.html';
    controls.append(link);
  }
  a.append(controls);
  return a;
}
function render() {
  const search = $('search').value.trim().toLowerCase();
  $('items').replaceChildren(
    ...items
      .filter(
        (r) => r.status === 'published' && (r.title + r.description).toLowerCase().includes(search),
      )
      .map((r) => itemCard(r, false)),
  );
  $('claims').replaceChildren(...claims.map((c) => claimCard(c, false)));
  $('managed').replaceChildren(...items.filter((r) => r.canManage).map((r) => itemCard(r, true)));
  $('managed-claims').replaceChildren(...managedClaims.map((c) => claimCard(c, true)));
  for (const id of ['items', 'claims', 'managed', 'managed-claims'])
    if (!$(id).children.length)
      $(id).append(
        node(
          'p',
          id === 'items'
            ? '本范围还没有已批准的奖励。'
            : id === 'claims'
              ? '领取之后，结果和后续处理会显示在这里。'
              : '目前没有可处理的记录。',
        ),
      );
}
async function refresh() {
  const result = await Promise.all([
    request(base() + '/items'),
    request(base() + '/claims'),
    request(base() + '/manage'),
  ]);
  items = result[0].items;
  claims = result[1].claims;
  managedClaims = result[2].claims;
  render();
  if (!$('history').hidden && historyClaim) await history(historyClaim, false);
}
async function loadTargets(selected) {
  const kind = $('edit-kind').value,
    org = $('edit-org').value;
  $('badge-label').hidden = kind !== 'badge';
  $('edit-badge').required = kind === 'badge';
  $('target-label').hidden = !['activity', 'partner'].includes(kind);
  $('edit-target').required = ['activity', 'partner'].includes(kind);
  targets = [];
  if (kind === 'activity') {
    targets = (
      await request('/activities/schools/' + encodeURIComponent(school()) + '/items')
    ).items
      .filter(
        (a) => (a.orgId || '') === org && a.canManage && ['draft', 'published'].includes(a.status),
      )
      .map((a) => ({ id: a.activityId, label: a.title + ' · ' + states[a.status] }));
    $('target-note').textContent =
      '只能首次绑定尚无报名的新草稿活动；批准奖励后才为该活动启用资格限制，其他活动保持原状。';
  } else if (kind === 'partner') {
    targets = (await request('/m5/schools/' + encodeURIComponent(school()) + '/offers')).offers
      .filter((o) => (o.orgId || '') === org)
      .map((o) => ({
        id: o.offerId,
        label: o.title,
        revision: o.revision,
        expiresAt: o.validUntil,
      }));
    $('target-note').textContent =
      '沿用已批准合作权益的原库存、条款和核销凭证；奖励期限不得晚于原权益。';
  } else
    $('target-note').textContent =
      kind === 'appearance'
        ? '只增加可选“校园贡献绶带”资格。原有免费部件不受影响，领取后在人物编辑中明确切换到奖励素材库。'
        : '徽章保存到个人档案，默认为本人可见；本人可选择展示。';
  $('edit-target').replaceChildren(
    new Option('请选择已准备的对象', ''),
    ...targets.map((t) => new Option(t.label, t.id)),
  );
  if (selected) $('edit-target').value = selected;
}
function local(d) {
  return new Date(d - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
async function edit(r) {
  editing = r;
  $('edit-heading').textContent = r ? '编辑奖励草稿' : '建立奖励草稿';
  $('edit-id').value = r?.rewardId || '';
  const current = me.schools.find((s) => s.school_id === school());
  const options = [];
  if (current?.role === 'owner') options.push(new Option('全校', ''));
  for (const o of orgs)
    if (capability.managedOrgIds?.includes(o.org_id) || current?.role === 'owner')
      options.push(new Option(o.name || o.org_id, o.org_id));
  if (!options.length) throw Error('当前账号没有可管理的学校或组织范围。');
  $('edit-org').replaceChildren(...options);
  $('edit-org').value = r?.orgId || options[0].value;
  $('edit-org').disabled = Boolean(r);
  $('edit-kind').value = r?.kind || 'badge';
  $('edit-title').value = r?.title || '';
  $('edit-description').value = r?.description || '';
  $('edit-badge').value = r?.target?.label || '校园共同建设者';
  $('edit-minimum').value = r?.minimumContribution || 0;
  $('edit-period').value = r?.contributionPeriod || '';
  $('edit-stock').value = r?.stock || 10;
  $('edit-demonstration').value = String(r?.demonstration ?? true);
  $('edit-start').value = local(r ? Date.parse(r.startsAt) : Date.now() - 60000);
  $('edit-expiry').value = local(r ? Date.parse(r.expiresAt) : Date.now() + 7 * 86400000);
  await loadTargets(r?.target?.activityId || r?.target?.offerId);
  document.querySelectorAll('.action-error').forEach((n) => n.remove());
  $('edit-dialog').showModal();
}
async function loadSchool() {
  $('workspace').hidden = true;
  $('history').hidden = true;
  historyClaim = null;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  if (window.rewardsQA) window.rewardsQA.ready = false;
  capability = await request(base() + '/status');
  orgs = (await request('/m1/schools/' + encodeURIComponent(school()) + '/organizations'))
    .organizations;
  await refresh();
  $('workspace').hidden = false;
  window.rewardsQA = { ready: true, school: school() };
  message('奖励规则与领取结果按当前学校和组织权限读取。');
}
$('school').onchange = perform(loadSchool);
$('search').oninput = render;
$('refresh').onclick = perform(async () => {
  await refresh();
  message('奖励与处理结果已更新。');
});
$('refresh-mine').onclick = perform(async () => {
  await refresh();
  message('领取记录和处理轨迹已更新。');
});
$('new-reward').onclick = perform(() => edit());
$('edit-kind').onchange = perform(() => loadTargets());
$('edit-org').onchange = perform(() => loadTargets());
$('close-history').onclick = () => {
  $('history').hidden = true;
};
document
  .querySelectorAll('[data-close]')
  .forEach((b) => (b.onclick = () => b.closest('dialog').close()));
document.querySelectorAll('[data-panel]').forEach(
  (b) =>
    (b.onclick = perform(async () => {
      switchTab(b.dataset.panel);
      await refresh();
    })),
);
$('edit-form').onsubmit = perform(async () => {
  const kind = $('edit-kind').value,
    selection = targets.find((t) => t.id === $('edit-target').value);
  let target =
    kind === 'badge'
      ? { label: $('edit-badge').value.trim() }
      : kind === 'appearance'
        ? { itemId: 'appearance:community-ribbon' }
        : kind === 'activity'
          ? { activityId: selection?.id }
          : { offerId: selection?.id, offerRevision: selection?.revision };
  await write(base() + '/items' + (editing ? '/' + editing.rewardId + '/edit' : ''), {
    ...(editing ? { expectedRevision: editing.revision } : {}),
    orgId: $('edit-org').value || null,
    kind,
    title: $('edit-title').value.trim(),
    description: $('edit-description').value.trim(),
    target,
    minimumContribution: Number($('edit-minimum').value),
    contributionPeriod: $('edit-period').value.trim() || null,
    stock: Number($('edit-stock').value),
    startsAt: new Date($('edit-start').value).toISOString(),
    expiresAt: new Date($('edit-expiry').value).toISOString(),
    demonstration: $('edit-demonstration').value === 'true',
  });
  $('edit-dialog').close();
  switchTab('manage');
  await refresh();
  message('奖励草稿已保存；提交并审核后才开放领取。');
});
$('action-form').onsubmit = perform(async () => {
  const { kind, row: r } = action;
  let result;
  if (['claim', 'review'].includes(kind) && !$('action-terms').checked)
    throw Error('请先确认已读清楚用途、条件与后果。');
  if (r.demonstration && ['claim', 'review'].includes(kind) && !$('action-demo').checked)
    throw Error('请明确确认这是演示奖励。');
  if (kind === 'claim')
    result = await write(base() + '/items/' + r.rewardId + '/claim', {
      expectedRevision: r.revision,
      acceptedTerms: true,
      acknowledgeDemonstration: $('action-demo').checked,
    });
  else if (kind === 'revoke')
    result = await write(base() + '/claims/' + r.claimId + '/revoke', {
      expectedRevision: r.revision,
      reason: $('action-reason').value.trim(),
    });
  else
    result = await write(
      base() + '/items/' + r.rewardId + '/' + (kind === 'withdraw' ? 'withdraw' : 'review'),
      {
        expectedRevision: r.revision,
        reason: $('action-reason').value.trim(),
        ...(kind === 'withdraw'
          ? {}
          : {
              decision: kind === 'review' ? 'publish' : 'reject',
              ...(kind === 'review'
                ? {
                    confirmation: r.demonstration ? 'publish-demonstration' : 'publish-real-reward',
                  }
                : {}),
            }),
      },
    );
  $('action-dialog').close();
  await refresh();
  if (kind === 'claim') {
    switchTab('mine');
    message(
      result.status === 'fulfilled'
        ? '奖励已实际发放，请查看记录与下一步。'
        : '发放未完成，已保留原份额，可按记录重试。',
      result.status !== 'fulfilled',
    );
  } else
    message(
      kind === 'revoke'
        ? '奖励已撤销，原发放与冲正记录均保留。'
        : kind === 'review'
          ? '奖励已审核发布。'
          : '处理结果已记录。',
    );
});
try {
  me = await request('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  if (!me.extensions?.includes('rewards')) message('当前部署尚未启用奖励模块。');
  else if (me.schools.length) await loadSchool();
  else message('加入学校后可查看获准奖励。');
} catch (e) {
  if (e.status === 401) {
    $('login').hidden = false;
    message('请先登录学校账号。');
  } else message(e.message, true);
}
