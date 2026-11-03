const $ = (id) => document.getElementById(id);
const states = {
  pending: '等待学校审核',
  approved: '合作有效',
  rejected: '审核未通过',
  withdrawn: '已下架 / 退出',
  published: '已审核发布',
  proposed: '等待本人授权',
  queued: '已授权，等待办理',
  pending_confirmation: '合作方结果待确认',
  confirmed: '已有办理回执',
  cancel_requested: '已请求取消',
  cancel_pending: '取消结果待确认',
  cancelled: '已取消',
  failed: '未完成办理',
  adapter_unavailable: '合作方办理接口未连接',
  issued: '待使用',
  redeemed: '已核销',
  revoked: '已撤销',
  expired: '已过期',
};
const labels = {
  question: '办理内容',
  requestedTime: '希望的时间',
  contactName: '称呼',
  contactHandle: '联系方式',
};
const errors = {
  revision_conflict: '记录已有更新，请刷新后核对新版本再操作。',
  request_conflict: '这次操作的内容已改变，请刷新核对已保存结果。',
  service_revision_changed: '服务资料已经更新。请重新查看办理条件，再准备这次咨询或预约。',
  partner_scope_denied: '你目前没有这家合作方的对应权限。',
  school_member_required: '这项个人服务仅对本校成员开放。',
  member_denied: '当前学校成员资格不可用，请重新核对账号。',
  partner_unavailable: '合作方尚未通过审核、已经退出或已过期。',
  service_unavailable: '这项服务已经下架、过期或正在重新审核。',
  offer_unavailable: '这项权益暂不可领取，请更新页面查看状态。',
  offer_sold_out: '这项权益已经领完。',
  offer_already_claimed: '你已经领取过，请到“我的权益”查看。',
  offer_eligibility_denied: '这项权益仅对指定组织的有效成员开放。',
  contribution_eligibility_denied: '你的有效贡献尚未达到领取条件。',
  voucher_scope_denied: '核销码与当前学校或合作方不匹配。',
  voucher_unavailable: '这份权益已使用、撤销或过期。',
  voucher_invalid: '核销码不完整，请重新复制持有人出示的完整内容。',
  explicit_consent_required: '请本人核对信息并勾选授权。',
  task_not_cancellable: '这项办理正在取消或已结束，请更新状态。',
  source_or_account_unavailable: '服务资料或账号权限已变化，无法继续提交。',
  future_expiry_required: '有效期必须晚于现在。',
  official_https_url_required: '官方入口请填写不含账号信息的 HTTPS 地址。',
  partner_organization_denied: '该账号需要先成为关联合作组织的有效成员。',
  stock_below_issued: '总份数不能少于已经发出的份数。',
  route_missing: '当前运行版本尚未启用这项功能。',
};
let me, adapter, selectedService, selectedSource, proposal, claimOffer, selectedPartner;
let directory = [],
  myPartners = [],
  managedServices = [],
  managedOffers = [],
  schoolMembers = [],
  contacts = [];
let currentPanel = 'directory',
  epoch = 0,
  decision,
  activeOperations = 0;
const pending = new Map();
const schoolId = () => $('school').value;
const root = () => '/m5/schools/' + encodeURIComponent(schoolId());
const owner = () => me?.schools.find((s) => s.school_id === schoolId())?.role === 'owner';
const date = (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '未提供');
const localDate = (v) => {
  const d = new Date(v);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const nextMonth = () => localDate(Date.now() + 30 * 86400000);
const iso = (id) => new Date($(id).value).toISOString();
function status(text, bad = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', bad);
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function empty(el, text) {
  el.replaceChildren(node('p', text, 'empty'));
}
function badge(state) {
  const el = node('span', states[state] || state, 'badge');
  el.dataset.state = state;
  return el;
}
function facts(el, values) {
  el.replaceChildren(
    ...values.flatMap(([name, value]) => [node('dt', name), node('dd', value ?? '未提供')]),
  );
}
function action(label, fn, className = '') {
  const button = node('button', label, className);
  button.type = 'button';
  button.onclick = perform(fn);
  return button;
}
function card(title, state, body) {
  const el = node('article', null, 'card');
  if (state) el.append(badge(state));
  el.append(node('h3', title));
  if (body) el.append(node('p', body, 'description'));
  return el;
}
async function request(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    const e = Error('连接中断，结果尚未确认。请保持原内容重试同一次操作，或更新记录核对结果。');
    e.uncertain = true;
    throw e;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    const e = Error('未收到可核对的响应，请更新记录后再操作。');
    e.uncertain = true;
    throw e;
  }
  if (!response.ok) {
    const code = data.error?.code || data.error?.message || 'unknown';
    const e = Error(errors[code] || `操作未完成（${code}），请核对输入或更新记录。`);
    e.status = response.status;
    e.uncertain = response.status >= 500;
    throw e;
  }
  return data;
}
async function write(path, body, operation = path) {
  const fingerprint = JSON.stringify(body),
    previous = pending.get(operation);
  if (previous && previous.fingerprint !== fingerprint)
    throw Error('上一次提交仍未确认。请保留原内容重试或先核对记录，不要立即改内容重复提交。');
  const attempt = previous || { fingerprint, requestId: crypto.randomUUID() };
  pending.set(operation, attempt);
  try {
    const result = await request(path, { requestId: attempt.requestId, ...body });
    pending.delete(operation);
    return result;
  } catch (e) {
    if (!e.uncertain) pending.delete(operation);
    throw e;
  }
}
function perform(fn) {
  return async (event) => {
    event?.preventDefault();
    const el = event?.currentTarget;
    const buttons =
      el?.tagName === 'FORM'
        ? [...el.querySelectorAll('button')]
        : el?.tagName === 'BUTTON'
          ? [el]
          : [];
    if (el?.dataset.busy === 'true') return;
    if (el) el.dataset.busy = 'true';
    buttons.forEach((b) => (b.disabled = true));
    activeOperations++;
    $('school').disabled = true;
    for (const error of document.querySelectorAll('.dialog-error')) error.remove();
    try {
      await fn(event);
    } catch (e) {
      status(e.message, true);
      const dialog = document.querySelector('dialog[open]');
      if (dialog) {
        const message = node('p', e.message, 'notice dialog-error');
        message.setAttribute('role', 'alert');
        dialog.append(message);
      }
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      if (el) delete el.dataset.busy;
      activeOperations--;
      $('school').disabled = activeOperations > 0;
    }
  };
}
function panel(name) {
  currentPanel = name;
  for (const p of ['directory', 'mine', 'manage', 'redeem']) {
    $(p + '-panel').hidden = p !== name;
    $('tab-' + p).setAttribute('aria-selected', String(p === name));
  }
}
function openDecision(title, description, fn, submit = '确认操作') {
  decision = fn;
  $('decision-heading').textContent = title;
  $('decision-description').textContent = description;
  $('decision-reason').value = '';
  $('decision-submit').textContent = submit;
  $('decision-dialog').showModal();
}
function displayDirectory() {
  const term = $('search').value.trim().toLocaleLowerCase();
  const rows = directory.filter((s) => (s.title + ' ' + s.text).toLocaleLowerCase().includes(term));
  $('directory-count').textContent = `${rows.length} 项当前有效服务`;
  if (!rows.length)
    return empty(
      $('directory'),
      directory.length
        ? '没有匹配的服务，试试其他关键词。'
        : '学校还没有发布合作服务。合作方可以提交入驻申请，审核通过的资料会显示在这里。',
    );
  $('directory').replaceChildren(
    ...rows.map((s) => {
      const el = card(s.title, 'published', s.text.split('\n')[0]);
      el.dataset.serviceId = s.serviceId;
      el.append(node('p', `资料有效至 ${date(s.validUntil)}`, 'meta'));
      const controls = node('div', null, 'actions');
      controls.append(action('查看条件与服务', () => openService(s), 'primary'));
      el.append(controls);
      return el;
    }),
  );
}
async function loadDirectory() {
  const at = epoch,
    data = await request(root() + '/directory');
  if (at !== epoch) return;
  directory = data.sources;
  displayDirectory();
}
async function openService(source) {
  const at = epoch,
    base = root();
  const [s, offers] = await Promise.all([
    request(base + '/services/' + source.serviceId),
    request(base + '/offers?partnerId=' + source.partnerId),
  ]);
  if (at !== epoch) return;
  selectedSource = source;
  selectedService = s;
  const partnerName = source.partnerName || source.text.split('：')[0];
  $('service-partner').textContent = partnerName;
  $('service-title').textContent = s.title;
  $('service-description').textContent = s.description;
  facts($('service-facts'), [
    ['办理条件', s.conditions],
    ['服务时间', s.hours],
    ['有效期', date(s.validUntil)],
    ...(s.entityId ? [['所在地点', s.entityId]] : []),
  ]);
  $('official-link').hidden = !s.officialUrl;
  if (s.officialUrl) $('official-link').href = s.officialUrl;
  $('location-link').hidden = !s.sceneId;
  if (s.sceneId)
    $('location-link').href =
      '/?' + new URLSearchParams({ space: schoolId(), scene: s.sceneId, entity: s.entityId });
  $('service-source').textContent =
    `来源：学校已审核的合作资料 · 版本 ${s.revision}。具体办理以当前条件及合作方回执为准。`;
  if (!offers.offers.length) empty($('service-offers'), '这家合作方目前没有可领取权益。');
  else $('service-offers').replaceChildren(...offers.offers.map((o) => offerCard(o, false)));
  $('service-detail').hidden = false;
  $('service-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await write(base + '/services/' + s.serviceId + '/exposure', {});
}
function offerCard(o, manage) {
  const el = card(o.title, o.status, o.terms);
  el.dataset.offerId = o.offerId;
  el.append(
    node(
      'p',
      `剩余 ${Math.max(0, o.stock - o.issued)} 份 · 每人限领 1 份 · 贡献需达 ${o.minContribution}`,
      'meta',
    ),
    node('p', `有效至 ${date(o.validUntil)}`, 'meta'),
  );
  if (o.orgId) el.append(node('p', '限指定组织成员：' + o.orgId, 'meta'));
  const buttons = node('div', null, 'actions');
  if (manage) {
    buttons.append(action('修改权益', () => editOffer(o)));
    publicationActions(buttons, 'offers', o, o.offerId);
  } else buttons.append(action('查看条件并领取', () => openClaim(o), 'primary'));
  el.append(buttons);
  return el;
}
function openClaim(o) {
  claimOffer = o;
  $('claim-heading').textContent = o.title;
  $('claim-terms').textContent = o.terms;
  $('claim-check').checked = false;
  facts($('claim-facts'), [
    ['有效期', date(o.validUntil)],
    [
      '最低贡献',
      `${o.minContribution}（${o.contributionPeriod || '所有周期'}，领取不扣除历史贡献）`,
    ],
    ['剩余份数', Math.max(0, o.stock - o.issued)],
    [
      '合作方退出',
      o.withdrawalPolicy === 'honor'
        ? '已领取权益仍履行至约定到期日'
        : '未使用权益将撤销，并通知持有人',
    ],
    ...(o.orgId ? [['组织资格', o.orgId]] : []),
  ]);
  $('claim-dialog').showModal();
}
function taskNote(t) {
  const notes = {
    proposed: '内容目前只保存在你的账号中。查看分享字段并确认后，才会转交合作方。',
    queued: '授权已记录，正在等待服务办理。请查询这一条记录的后续结果。',
    pending_confirmation: '尚未取得可靠的外部回执。系统会核对原操作，请勿重新建立相同预约。',
    confirmed: '已收到办理回执。预约是否属于本地模拟，会在回执来源处标明。',
    adapter_unavailable: '内容和授权已保存，但合作方接口尚未连接。尚无合作方接单证据。',
    cancel_requested: '已提出取消请求，尚需取得取消回执。',
    cancel_pending: '取消结果还不确定，请继续查询这一条工单。',
    cancelled: '本次办理已取消，取消依据见下方回执。',
    failed: '未完成本次办理，请核对原因后决定下一步。',
  };
  return notes[t.status] || '请查询当前记录。';
}
function receiptText(r) {
  if (!r) return null;
  const who =
    r.provider === 'local-fixture'
      ? '本地虚构服务（自动验证）'
      : r.provider === 'base-local'
        ? 'Base 本地取消，未派发'
        : '已配置的合作方接口';
  return `${who} · ${r.status} · 回执 ${r.receiptId}`;
}
function taskCard(t, managed = false) {
  const el = card(t.sourceSnapshot?.title || '合作办理', t.status, taskNote(t));
  el.dataset.taskId = t.taskId;
  el.append(
    node('p', `${t.kind === 'appointment' ? '预约' : '咨询'} · ${date(t.createdAt)}`, 'meta'),
  );
  const detail = document.createElement('details');
  detail.append(node('summary', managed ? '查看用户授权内容' : '查看办理内容和回执'));
  const dl = node('dl', null, 'facts');
  facts(
    dl,
    Object.entries(t.request || {}).map(([k, v]) => [
      labels[k] || k,
      k === 'requestedTime' ? date(v) : v,
    ]),
  );
  detail.append(dl);
  if (t.consent)
    detail.append(
      node('p', '已同意分享：' + t.consent.fields.map((k) => labels[k] || k).join('、'), 'muted'),
    );
  for (const receipt of [t.externalReceipt, t.cancelReceipt])
    if (receipt) detail.append(node('p', receiptText(receipt), 'muted'));
  if (t.lastError)
    detail.append(node('p', errors[t.lastError] || '待核对原因：' + t.lastError, 'muted'));
  el.append(detail);
  const buttons = node('div', null, 'actions');
  if (!managed && ['proposed', 'adapter_unavailable'].includes(t.status))
    buttons.append(action('检查并确认分享', () => openConsent(t), 'primary'));
  if (['queued', 'pending_confirmation', 'cancel_requested', 'cancel_pending'].includes(t.status))
    buttons.append(
      action('查询已有办理结果', async () => {
        await request(root() + '/tasks/' + t.taskId + '/reconcile', {});
        if (managed) await loadPartner(selectedPartner.partnerId);
        else await loadMine();
        status('已核对原工单。请以当前状态和回执为准。');
      }),
    );
  if (!managed && !['cancelled', 'failed', 'cancel_requested', 'cancel_pending'].includes(t.status))
    buttons.append(
      action('取消本次办理', () =>
        openDecision(
          '取消这次办理',
          '尚未派发的请求会本地取消；已经派发的请求需等待合作方取消回执。',
          async (reason) => {
            await write(root() + '/tasks/' + t.taskId + '/cancel', {
              expectedRevision: t.revision,
              reason,
            });
            await loadMine();
            status('取消请求已记录，请查看当前状态。');
          },
          '提交取消请求',
        ),
      ),
    );
  el.append(buttons);
  return el;
}
function voucher(e) {
  const data = {
    schoolId: e.schoolId,
    partnerId: e.partnerId,
    entitlementId: e.entitlementId,
    revision: e.revision,
    token: e.token,
  };
  return (
    'HDV1.' +
    btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  );
}
function entitlementCard(e) {
  const el = card(e.terms.title, e.effectiveStatus || e.status, e.terms.terms);
  el.dataset.entitlementId = e.entitlementId;
  el.append(
    node('p', '有效至 ' + date(e.validUntil), 'meta'),
    node(
      'p',
      e.terms.withdrawalPolicy === 'honor'
        ? '合作方退出后仍按原约定履行至到期。'
        : '合作方退出时撤销未用权益并通知。',
      'meta',
    ),
  );
  if (e.effectiveStatus === 'issued') {
    const controls = node('div', null, 'actions'),
      code = document.createElement('textarea');
    code.className = 'voucher';
    code.readOnly = true;
    code.hidden = true;
    code.setAttribute('aria-label', '我的权益核销码');
    controls.append(
      action('出示核销码', () => {
        code.hidden = !code.hidden;
        code.value = code.hidden ? '' : voucher(e);
      }),
    );
    controls.append(
      action('复制核销码', async () => {
        try {
          await navigator.clipboard.writeText(voucher(e));
          status('核销码已复制。请只交给对应合作方的核销员。');
        } catch {
          code.hidden = false;
          code.value = voucher(e);
          code.focus();
          code.select();
          status('请从已选中的文本复制核销码。');
        }
      }),
    );
    el.append(controls, code);
  }
  if (e.redeemedAt) el.append(node('p', '核销时间 ' + date(e.redeemedAt), 'meta'));
  if (e.revokedReason) el.append(node('p', '撤销原因：' + e.revokedReason, 'meta'));
  return el;
}
async function loadMine() {
  const at = epoch,
    base = root();
  const [tasks, benefits] = await Promise.all([
    request(base + '/tasks'),
    request(base + '/entitlements'),
  ]);
  if (at !== epoch) return;
  if (tasks.tasks.length) $('my-tasks').replaceChildren(...tasks.tasks.map((t) => taskCard(t)));
  else empty($('my-tasks'), '还没有咨询或预约。可以从“发现服务”查看条件，再准备办理。');
  if (benefits.entitlements.length)
    $('my-entitlements').replaceChildren(...benefits.entitlements.map(entitlementCard));
  else empty($('my-entitlements'), '还没有领取权益。服务详情中会列出当前可领取的权益与条件。');
}
function openConsent(t) {
  proposal = t;
  $('consent-check').checked = false;
  const source = directory.find((s) => s.partnerId === t.partnerId);
  const name =
    selectedSource?.partnerId === t.partnerId
      ? selectedSource.partnerName || selectedSource.text.split('：')[0]
      : myPartners.find((p) => p.partnerId === t.partnerId)?.name ||
        (source ? source.partnerName || source.text.split('：')[0] : null);
  $('consent-recipient').textContent =
    `接收方：${name || '合作方 ' + t.partnerId} · ${t.sourceSnapshot.title}`;
  $('consent-purpose').textContent =
    `用途：${t.kind === 'appointment' ? '预约办理' : '咨询'}。下列字段将完整转交给这一合作方。`;
  facts(
    $('consent-fields'),
    Object.entries(t.request).map(([k, v]) => [
      labels[k] || k,
      k === 'requestedTime' ? date(v) : v,
    ]),
  );
  $('consent-source').textContent =
    `你依据的资料：${t.sourceSnapshot.title}，版本 ${t.sourceRevision}；办理条件：${t.sourceSnapshot.conditions}`;
  $('consent-adapter').textContent = adapter.fixtureOnly
    ? '当前连接本地虚构办理服务，用于自动验证；确认不会产生真实商户预约。'
    : !adapter.externalAdapterConfigured
      ? '合作方办理接口尚未连接。确认只保存授权，当前不能取得合作方接单回执。'
      : '确认后会提交给已配置的合作方接口。请以实际业务回执为准。';
  $('consent-dialog').showModal();
}
async function loadManage() {
  const at = epoch,
    base = root();
  const data = await request(base + '/partners');
  if (at !== epoch) return;
  myPartners = data.partners;
  $('manage-title').textContent = owner() ? '审核与管理学校合作' : '我负责的合作服务';
  $('apply-org-field').hidden = !owner();
  if (!myPartners.length) empty($('my-partners'), '还没有申请或被授权的合作方。可先提交入驻申请。');
  else
    $('my-partners').replaceChildren(
      ...myPartners.map((p) => {
        const el = card(p.name, p.status, p.description);
        el.dataset.partnerId = p.partnerId;
        el.dataset.selected = String(p.partnerId === selectedPartner?.partnerId);
        el.append(node('p', p.category + ' · 有效至 ' + date(p.validUntil), 'meta'));
        const buttons = node('div', null, 'actions');
        buttons.append(action('打开工作台', () => loadPartner(p.partnerId), 'primary'));
        el.append(buttons);
        return el;
      }),
    );
  const details = await Promise.all(
    myPartners
      .filter((p) => ['approved', 'withdrawn'].includes(p.status))
      .map(async (p) => request(base + '/partners/' + p.partnerId).catch(() => null)),
  );
  if (at !== epoch) return;
  const redeemable = details.filter(
    (p) =>
      p &&
      (owner() ||
        p.staff?.some((s) => s.userId === me.userId && s.role === 'redeemer' && s.active)),
  );
  const previousRedeemer = $('redeem-partner').value;
  $('redeem-partner').replaceChildren(
    new Option(redeemable.length ? '请选择合作方' : '暂无被授予核销权限的合作方', ''),
    ...redeemable.map((p) => new Option(p.name, p.partnerId)),
  );
  if (redeemable.some((p) => p.partnerId === previousRedeemer))
    $('redeem-partner').value = previousRedeemer;
  if (selectedPartner && myPartners.some((p) => p.partnerId === selectedPartner.partnerId))
    await loadPartner(selectedPartner.partnerId);
  else if (selectedPartner) {
    selectedPartner = null;
    $('partner-workspace').hidden = true;
    $('staff-list').replaceChildren();
    $('managed-tasks').replaceChildren();
    $('metrics').replaceChildren();
  }
}
function publicationActions(buttons, resource, item, id) {
  if (owner() && item.status === 'pending') {
    for (const [decision, title] of [
      ['publish', '审核发布'],
      ['reject', '拒绝发布'],
    ])
      buttons.append(
        action(
          title,
          () =>
            openDecision(
              title,
              '请核对资料与条件。审核决定会保留原因和操作记录。',
              async (reason) => {
                await write(root() + '/' + resource + '/' + id + '/review', {
                  expectedRevision: item.revision,
                  decision,
                  reason,
                });
                await loadPartner(selectedPartner.partnerId);
                await loadDirectory();
                status('审核结果已保存。');
              },
              title,
            ),
          decision === 'publish' ? 'primary' : '',
        ),
      );
  }
  if (item.status !== 'withdrawn')
    buttons.append(
      action(
        '下架',
        () =>
          openDecision(
            '下架这项' + (resource === 'services' ? '服务' : '权益'),
            resource === 'services'
              ? '下架后停止展示和新增办理。已有工单仍保留记录。'
              : '下架后停止新领取。已发权益继续依据领取时条款处理。',
            async (reason) => {
              await write(root() + '/' + resource + '/' + id + '/withdraw', {
                expectedRevision: item.revision,
                reason,
              });
              await loadPartner(selectedPartner.partnerId);
              await loadDirectory();
              status('已下架，历史记录保留。');
            },
          ),
        'danger',
      ),
    );
}
async function loadPartner(id) {
  const at = epoch,
    base = root(),
    p = await request(base + '/partners/' + id);
  if (at !== epoch) return;
  selectedPartner = p;
  $('partner-workspace').hidden = false;
  $('partner-name').textContent = p.name;
  $('partner-category').textContent = p.category;
  $('partner-status').textContent = states[p.status];
  $('partner-status').dataset.state = p.status;
  $('partner-description').textContent = p.description;
  $('partner-review-reason').textContent =
    `有效至 ${date(p.validUntil)}` + (p.reviewReason ? ' · 最近处理原因：' + p.reviewReason : '');
  $('partner-actions').replaceChildren();
  if (owner() && p.status === 'pending')
    for (const [decision, title] of [
      ['approve', '审核通过入驻'],
      ['reject', '拒绝入驻'],
    ])
      $('partner-actions').append(
        action(
          title,
          () =>
            openDecision(
              title,
              '请核对合作方资格与资料。通过后，申请人会获得这家合作方的资料维护权限。',
              async (reason) => {
                await write(base + '/partners/' + id + '/review', {
                  expectedRevision: p.revision,
                  decision,
                  reason,
                });
                await loadManage();
                status('入驻审核结果已保存。');
              },
              title,
            ),
          decision === 'approve' ? 'primary' : '',
        ),
      );
  const ownRole = p.staff?.find((s) => s.userId === me.userId && s.active)?.role;
  const maintain = owner() || ownRole === 'maintainer';
  if (maintain && p.status !== 'withdrawn')
    $('partner-actions').append(
      action(
        '结束这项合作',
        () =>
          openDecision(
            '结束合作并停止新办理',
            '已发权益会依领取时约定保留或撤销，并向持有人发通知；已有外部工单仍需核对回执。',
            async (reason) => {
              await write(base + '/partners/' + id + '/withdraw', {
                expectedRevision: p.revision,
                reason,
              });
              await loadManage();
              await loadDirectory();
              status('合作已退出，已发权益按原约定处理。');
            },
            '确认结束合作',
          ),
        'danger',
      ),
    );
  $('staff-section').hidden = !p.staff;
  $('staff-form').hidden = !owner() || p.status !== 'approved';
  if (p.staff)
    $('staff-list').replaceChildren(
      ...p.staff.map((s) => {
        const name =
          contacts.find((c) => c.user_id === s.userId)?.display_name ||
          '账号 ' + s.userId.slice(0, 8);
        const row = node('div', null, 'staff-row');
        row.append(
          node(
            'span',
            `${name} · ${s.role === 'maintainer' ? '资料维护者' : '核销员'} · ${s.active ? '有效' : '已撤销'}`,
          ),
        );
        if (owner() && p.status === 'approved')
          row.append(
            action('调整权限', () => {
              $('staff-user').value = s.userId;
              $('staff-role').value = s.role;
              $('staff-active').checked = s.active;
              $('staff-reason').focus();
            }),
          );
        return row;
      }),
    );
  $('partner-maintenance').hidden = !maintain;
  $('service-form').hidden = true;
  $('offer-form').hidden = true;
  $('new-service').disabled = p.status !== 'approved';
  $('new-offer').disabled = p.status !== 'approved';
  if (!maintain) return;
  const [services, offers, tasks, metrics] = await Promise.all([
    request(base + '/services?partnerId=' + id),
    request(base + '/offers?partnerId=' + id + '&manage=true'),
    request(base + '/partners/' + id + '/tasks'),
    request(base + '/partners/' + id + '/metrics'),
  ]);
  if (at !== epoch || selectedPartner.partnerId !== id) return;
  managedServices = services.services;
  managedOffers = offers.offers;
  if (!managedServices.length)
    empty($('managed-services'), '通过入驻审核后，添加可供学校成员查阅的服务资料。');
  else
    $('managed-services').replaceChildren(
      ...managedServices.map((s) => {
        const el = card(s.title, s.status, s.description);
        el.dataset.serviceId = s.serviceId;
        el.append(
          node('p', '条件：' + s.conditions, 'meta'),
          node('p', '有效至 ' + date(s.validUntil), 'meta'),
        );
        if (s.reviewReason) el.append(node('p', '处理原因：' + s.reviewReason, 'meta'));
        const buttons = node('div', null, 'actions');
        if (p.status === 'approved') buttons.append(action('修改服务资料', () => editService(s)));
        publicationActions(buttons, 'services', s, s.serviceId);
        el.append(buttons);
        return el;
      }),
    );
  if (!managedOffers.length)
    empty($('managed-offers'), '还没有提交合作权益。请明确使用条件、数量、有效期与退出处理规则。');
  else $('managed-offers').replaceChildren(...managedOffers.map((o) => offerCard(o, true)));
  if (!tasks.tasks.length)
    empty($('managed-tasks'), '暂无用户确认转交的工单。用户尚未授权的草稿不会出现在这里。');
  else $('managed-tasks').replaceChildren(...tasks.tasks.map((t) => taskCard(t, true)));
  $('metrics-note').textContent =
    '曝光按同一账号、服务和 UTC 日期去重；咨询按确认工单、领取和核销按业务回执计算。仅返回本合作方汇总，不代表真人到店。';
  $('metrics').replaceChildren(
    ...[
      ['exposure', '服务详情查看'],
      ['consultation', '已确认咨询 / 预约'],
      ['claim', '领取'],
      ['redemption', '核销'],
    ].map(([key, label]) => {
      const el = node('div', null, 'metric');
      el.append(
        node('strong', metrics.metrics.find((m) => m.kind === key)?.count || 0),
        node('span', label),
      );
      return el;
    }),
  );
  $('entitlement-metrics').replaceChildren(
    ...metrics.entitlements.map((s) =>
      node('span', `${states[s.status] || s.status} ${s.count} 份`),
    ),
  );
}
function editService(s) {
  $('service-form').hidden = false;
  $('edit-service-id').value = s?.serviceId || '';
  $('service-form-title').textContent = s ? '修改并重新提交审核' : '添加服务';
  for (const [field, key] of [
    ['title', 'title'],
    ['description', 'description'],
    ['conditions', 'conditions'],
    ['hours', 'hours'],
    ['url', 'officialUrl'],
    ['scene', 'sceneId'],
    ['entity', 'entityId'],
  ])
    $('edit-service-' + field).value = s?.[key] || '';
  $('edit-service-until').value = s ? localDate(s.validUntil) : nextMonth();
  $('service-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('edit-service-title').focus();
}
function editOffer(o) {
  $('offer-form').hidden = false;
  $('edit-offer-id').value = o?.offerId || '';
  $('offer-form-title').textContent = o ? '修改并重新提交审核' : '添加权益';
  for (const [field, key] of [
    ['title', 'title'],
    ['terms', 'terms'],
    ['period', 'contributionPeriod'],
    ['org', 'orgId'],
  ])
    $('edit-offer-' + field).value = o?.[key] || '';
  $('edit-offer-stock').value = o?.stock || 20;
  $('edit-offer-score').value = o?.minContribution || 0;
  $('edit-offer-policy').value = o?.withdrawalPolicy || 'honor';
  $('edit-offer-until').value = o ? localDate(o.validUntil) : nextMonth();
  $('offer-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('edit-offer-title').focus();
}
async function loadSchool() {
  epoch++;
  $('workspace').hidden = true;
  if (window.partnersQA) window.partnersQA.ready = false;
  selectedPartner = null;
  selectedService = null;
  selectedSource = null;
  proposal = null;
  $('partner-workspace').hidden = true;
  $('service-detail').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('redeem-code').value = '';
  $('redemption-result').textContent = '';
  $('consent-check').checked = false;
  adapter = await request(root() + '/status');
  $('adapter-note').textContent = adapter.fixtureOnly
    ? '演示环境：预约接入的是本地虚构服务，用于流程自动验证；不产生真实商户订单。'
    : adapter.externalAdapterConfigured
      ? '预约由已配置的合作方接口办理。请先核对分享字段，再确认提交，并查看业务回执。'
      : '合作方办理接口尚未连接。你仍可查看已审服务与领取本地权益；预约会明确保留为待接入状态。';
  $('adapter-note').classList.toggle('warning', !adapter.externalAdapterConfigured);
  if (owner()) {
    const [m, c] = await Promise.all([
      request('/m1/schools/' + encodeURIComponent(schoolId()) + '/members'),
      request('/m1/schools/' + encodeURIComponent(schoolId()) + '/contacts').catch(() => ({
        contacts: [],
      })),
    ]);
    schoolMembers = m.members.filter((m) => m.active);
    contacts = c.contacts;
    $('staff-user').replaceChildren(
      ...schoolMembers.map(
        (m) =>
          new Option(
            `${contacts.find((c) => c.user_id === m.user_id)?.display_name || '账号 ' + m.user_id.slice(0, 8)} · ${m.role}`,
            m.user_id,
          ),
      ),
    );
  }
  await Promise.all([loadDirectory(), loadMine(), loadManage()]);
  $('workspace').hidden = false;
  status(`${me.name}，当前办理记录和权限均属于 ${schoolId()}。`);
  window.partnersQA = {
    ready: true,
    school: schoolId(),
    fixtureOnly: adapter.fixtureOnly,
    currentPanel: () => currentPanel,
  };
}
for (const b of document.querySelectorAll('[data-panel]'))
  b.onclick = perform(async () => {
    panel(b.dataset.panel);
    if (b.dataset.panel === 'mine') await loadMine();
    if (['manage', 'redeem'].includes(b.dataset.panel)) await loadManage();
  });
for (const b of document.querySelectorAll('[data-close]'))
  b.onclick = () => b.closest('dialog').close();
$('search').oninput = displayDirectory;
$('refresh-directory').onclick = perform(async () => {
  await loadDirectory();
  status('已更新当前有效的服务资料。');
});
$('close-service').onclick = () => ($('service-detail').hidden = true);
$('refresh-mine').onclick = perform(async () => {
  await loadMine();
  status('已更新本人的预约与权益。');
});
$('refresh-manage').onclick = perform(loadManage);
$('school').onchange = perform(loadSchool);
$('new-request').onclick = perform(() => {
  $('request-form').reset();
  $('request-kind').value = 'consultation';
  $('request-time-field').hidden = true;
  $('request-time').required = false;
  $('request-recipient').textContent =
    `${selectedSource.partnerName || selectedSource.text.split('：')[0]} · ${selectedService.title}`;
  $('request-dialog').showModal();
});
$('request-kind').onchange = () => {
  const on = $('request-kind').value === 'appointment';
  $('request-time-field').hidden = !on;
  $('request-time').required = on;
};
$('request-form').onsubmit = perform(async () => {
  const payload = { question: $('request-question').value.trim() };
  if ($('request-kind').value === 'appointment') payload.requestedTime = iso('request-time');
  if ($('request-name').value.trim()) payload.contactName = $('request-name').value.trim();
  if ($('request-contact').value.trim()) payload.contactHandle = $('request-contact').value.trim();
  const t = await write(
    root() + '/tasks',
    { serviceId: selectedService.serviceId, kind: $('request-kind').value, request: payload },
    root() + '/prepare-request',
  );
  $('request-dialog').close();
  openConsent(t);
  status('办理草稿已保存。请核对收件方和字段，再决定是否授权。');
});
$('consent-form').onsubmit = perform(async () => {
  await write(root() + '/tasks/' + proposal.taskId + '/confirm', {
    expectedRevision: proposal.revision,
    confirmed: $('consent-check').checked,
    consentFields: Object.keys(proposal.request),
  });
  $('consent-dialog').close();
  panel('mine');
  await loadMine();
  status('授权已保存。请查看这条工单的当前状态和回执。');
});
$('claim-form').onsubmit = perform(async () => {
  await write(root() + '/offers/' + claimOffer.offerId + '/claim', {
    expectedRevision: claimOffer.revision,
    acceptedTerms: $('claim-check').checked,
  });
  $('claim-dialog').close();
  panel('mine');
  await loadMine();
  status('已领取一份权益，历史贡献没有减少。');
});
$('decision-form').onsubmit = perform(async () => {
  await decision($('decision-reason').value.trim());
  $('decision-dialog').close();
});
$('application-form').onsubmit = perform(async () => {
  const input = {
    name: $('apply-name').value.trim(),
    category: $('apply-category').value.trim(),
    description: $('apply-description').value.trim(),
    validUntil: iso('apply-until'),
  };
  if (owner() && $('apply-org').value.trim()) input.orgId = $('apply-org').value.trim();
  const p = await write(root() + '/partners', input);
  $('application-form').reset();
  $('apply-until').value = nextMonth();
  await loadManage();
  await loadPartner(p.partnerId);
  status('申请已提交。学校负责人审核通过后，可维护服务资料。');
});
$('staff-form').onsubmit = perform(async () => {
  const target = $('staff-user').value,
    previous = selectedPartner.staff?.find((s) => s.userId === target);
  await write(root() + '/partners/' + selectedPartner.partnerId + '/staff', {
    expectedRevision: previous?.revision || 0,
    userId: target,
    role: $('staff-role').value,
    active: $('staff-active').checked,
    reason: $('staff-reason').value.trim(),
  });
  await loadManage();
  status('人员权限已更新；已有会话的后续操作也会重新校验权限。');
});
$('new-service').onclick = () => editService(null);
$('cancel-service').onclick = () => ($('service-form').hidden = true);
$('new-offer').onclick = () => editOffer(null);
$('cancel-offer').onclick = () => ($('offer-form').hidden = true);
$('service-form').onsubmit = perform(async () => {
  const id = $('edit-service-id').value,
    old = managedServices.find((s) => s.serviceId === id),
    body = {
      partnerId: selectedPartner.partnerId,
      title: $('edit-service-title').value.trim(),
      description: $('edit-service-description').value.trim(),
      conditions: $('edit-service-conditions').value.trim(),
      hours: $('edit-service-hours').value.trim(),
      officialUrl: $('edit-service-url').value.trim() || null,
      validUntil: iso('edit-service-until'),
    };
  if ($('edit-service-scene').value.trim() || $('edit-service-entity').value.trim()) {
    body.sceneId = $('edit-service-scene').value.trim();
    body.entityId = $('edit-service-entity').value.trim();
  }
  if (id) body.expectedRevision = old.revision;
  await write(root() + '/services' + (id ? '/' + id + '/edit' : ''), body);
  await loadPartner(selectedPartner.partnerId);
  await loadDirectory();
  status('服务资料已提交审核。待审资料不会公开。');
});
$('offer-form').onsubmit = perform(async () => {
  const id = $('edit-offer-id').value,
    old = managedOffers.find((o) => o.offerId === id),
    body = {
      partnerId: selectedPartner.partnerId,
      title: $('edit-offer-title').value.trim(),
      terms: $('edit-offer-terms').value.trim(),
      stock: Number($('edit-offer-stock').value),
      minContribution: Number($('edit-offer-score').value),
      withdrawalPolicy: $('edit-offer-policy').value,
      validUntil: iso('edit-offer-until'),
    };
  if ($('edit-offer-period').value.trim())
    body.contributionPeriod = $('edit-offer-period').value.trim();
  if ($('edit-offer-org').value.trim()) body.orgId = $('edit-offer-org').value.trim();
  if (id) body.expectedRevision = old.revision;
  await write(root() + '/offers' + (id ? '/' + id + '/edit' : ''), body);
  await loadPartner(selectedPartner.partnerId);
  status('权益已提交审核。已有持有人仍按领取时约定使用。');
});
$('redeem-form').onsubmit = perform(async () => {
  const raw = $('redeem-code').value.trim();
  let v;
  try {
    if (!raw.startsWith('HDV1.') || raw.length > 1500) throw Error();
    v = JSON.parse(atob(raw.slice(5).replaceAll('-', '+').replaceAll('_', '/')));
  } catch {
    throw Error('核销码格式不正确，请完整复制 HDV1. 开头的内容。');
  }
  if (v.schoolId !== schoolId() || v.partnerId !== $('redeem-partner').value)
    throw Error('核销码不属于当前学校或所选合作方，请先核对。');
  if (!/^[0-9a-f-]{36}$/i.test(v.entitlementId || '') || !Number.isSafeInteger(v.revision))
    throw Error('核销码缺少有效的权益信息。');
  const r = await write(root() + '/entitlements/' + v.entitlementId + '/redeem', {
    expectedRevision: v.revision,
    partnerId: v.partnerId,
    token: v.token,
  });
  $('redeem-code').value = '';
  $('redeem-confirm').checked = false;
  $('redemption-result').textContent = '核销成功 · 已使用一次 · 回执 ' + r.receiptId;
  status('核销已完成并记录回执。');
});
$('apply-until').value = nextMonth();
try {
  me = await request('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  const link = new URLSearchParams(location.search),
    chosen = link.get('school');
  if (chosen && !me.schools.some((s) => s.school_id === chosen))
    throw Error('当前账号没有链接所指学校的访问权限。');
  if (me.schools.some((s) => s.school_id === chosen)) $('school').value = chosen;
  if (!me.extensions?.includes('partners')) {
    $('unavailable').hidden = false;
    status('当前版本尚未启用合作服务。');
  } else if (!me.schools.length) {
    status('你已登录，请先接受学校邀请，再进入本校服务。');
  } else {
    $('workspace').hidden = false;
    await loadSchool();
    if (link.get('service')) {
      const service = directory.find((s) => s.serviceId === link.get('service'));
      if (!service) throw Error('链接中的服务已撤回、到期或不在当前获准范围。');
      await openService(service);
    }
  }
} catch (e) {
  if (e.status === 401) {
    $('login').hidden = false;
    status('请先登录学校账号。');
  } else status(e.message, true);
}
