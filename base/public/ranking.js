const $ = (id) => document.getElementById(id),
  label = { draft: '草稿', approved: '已批准', active: '计分中', frozen: '已冻结' },
  reason = {
    no_effective_approved_rule: '没有已生效规则，保留零分',
    approved_rule_applied: '按批准规则计分',
    daily_cap_applied: '已应用每日额度',
    member_or_organization_ineligible: '当前成员或组织资格不符',
    published_revision_no_extra_credit: '正文更新不重复计分',
    original_exact_reversal: '按原分数冲正',
    original_already_reversed: '原分数已经冲正',
    audited_manual_adjustment: '有理由的独立人工调整',
    original_not_credited: '原始记录没有授分',
  };
let me,
  example,
  periods = [],
  rules = [],
  epoch = 0,
  cursor = '0',
  manager = false;
const attempts = new Map();
const school = () => $('school').value,
  org = () => $('org').value,
  base = () => '/ledger/schools/' + encodeURIComponent(school()),
  suffix = () => (org() ? '?org=' + encodeURIComponent(org()) : '');
function el(tag, text) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  return n;
}
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
async function api(path, body) {
  let r;
  try {
    r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw Error('连接中断，请保持输入并重试同一次操作。');
  }
  const data = await r.json();
  if (!r.ok) {
    const code = data.error?.code || data.error?.message;
    const e = Error(
      {
        revision_conflict: '记录已有新版本，请刷新再核对。',
        request_conflict: '此重试内容发生变化，请先刷新核对原结果。',
        example_acknowledgement_required: '需要明确确认这只是虚构示例规则。',
        active_period_overlap: '同一范围已有重叠的计分时期。',
        rule_version_immutable: '该规则版本已存在，内容不可改写。',
        school_owner_required: '需要学校负责人权限。',
        organization_owner_required: '需要组织负责人权限。',
        organization_denied: '当前组织权限已失效。',
      }[code] || '操作未完成：' + code,
    );
    e.status = r.status;
    throw e;
  }
  return data;
}
async function mutation(path, data) {
  const signature = path + JSON.stringify(data);
  let requestId = attempts.get(signature);
  if (!requestId) {
    requestId = crypto.randomUUID();
    attempts.set(signature, requestId);
  }
  try {
    const result = await api(path, { requestId, ...data });
    attempts.delete(signature);
    return result;
  } catch (e) {
    if (e.status && e.status < 500) attempts.delete(signature);
    throw e;
  }
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (error) {
    status(error.message, true);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
};
function button(name, fn) {
  const b = el('button', name);
  b.type = 'button';
  b.onclick = run(fn);
  return b;
}
const localDate = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function entryRows(rows, append = false) {
  if (!append) $('entries').replaceChildren();
  for (const r of rows) {
    const a = el('article');
    a.dataset.entryId = r.id;
    a.append(
      el('strong', `${r.delta > 0 ? '+' : ''}${r.delta} · ${reason[r.metadata?.reason] || r.kind}`),
      el('p', `分录 ${r.id} · 时期 ${r.period} · 规则 ${r.rule_version}`),
    );
    if (r.metadata?.ruleTerms) {
      const t = r.metadata.ruleTerms;
      a.append(
        el(
          'p',
          `每次 ${t.points}，类别日限 ${t.dayCap}，总日限 ${t.dailyCap}${t.exampleOnly ? '（虚构示例）' : ''}`,
        ),
      );
    }
    if (r.reverses) a.append(el('p', '冲正原分录 ' + r.reverses));
    if (r.metadata?.adjustmentReason) a.append(el('p', '调整理由：' + r.metadata.adjustmentReason));
    if (r.metadata?.sourceId)
      a.append(
        el(
          'small',
          `来源 ${r.metadata.sourceSystem} / ${r.metadata.sourceId} / v${r.metadata.sourceRevision}`,
        ),
      );
    $('entries').append(a);
  }
  if (!rows.length && !append) $('entries').append(el('p', '当前范围暂无贡献记录。'));
  cursor = rows.at(-1)?.id || cursor;
  $('more').hidden = rows.length < 200;
}
async function refresh() {
  const version = ++epoch,
    s = school(),
    o = org(),
    query = new URLSearchParams({ period: $('period').value || 'all' });
  if (o) query.set('org', o);
  if ($('semester').value && query.get('period') === 'all')
    query.set('semester', $('semester').value);
  $('ranking').replaceChildren();
  $('entries').replaceChildren();
  const [p, r, e] = await Promise.all([
    api(base() + '/periods' + suffix()),
    api(base() + '/rankings?' + query),
    api(base() + '/entries' + suffix()),
  ]);
  if (version !== epoch || s !== school() || o !== org()) return;
  periods = p.periods;
  manager = p.canManage;
  const selected = $('period').value;
  $('period').replaceChildren(
    new Option('累计榜', 'all'),
    ...periods.map((p) => new Option(p.label + ' · ' + label[p.status], p.period)),
  );
  $('period').value = [...$('period').options].some((x) => x.value === selected) ? selected : 'all';
  $('ranking-note').textContent = r.frozen
    ? `已冻结快照，第 ${r.generation} 代。后续纠错请由负责人重建。`
    : '当前有效成员；同分按稳定身份顺序排列。';
  $('ranking').replaceChildren(
    ...r.rows.map((x) => {
      const li = el('li', `${x.position}. ${x.name} · ${x.score} 分`);
      li.dataset.userId = x.userId;
      li.value = x.position;
      return li;
    }),
  );
  if (!r.rows.length) $('ranking').append(el('p', '当前范围暂无计分成员。'));
  $('ranking').dataset.scope = o;
  entryRows(e.entries);
  renderPeriods();
  status('已读取当前范围贡献与榜单。');
}
function renderPeriods() {
  $('manager').hidden = !manager;
  if (!manager) return;
  $('adjust-period').replaceChildren(
    ...periods.filter((p) => p.status !== 'draft').map((p) => new Option(p.label, p.period)),
  );
  $('periods').replaceChildren(
    ...periods.map((p) => {
      const a = el('article', `${p.label} · ${label[p.status]} · ${p.period} · ${p.rule_version}`);
      const action = (type, title) =>
        button(title, async () => {
          const reason = prompt('请填写本次操作理由（至少3字）');
          if (!reason) return;
          const data = { expectedRevision: p.revision, reason };
          if (
            type === 'activate' &&
            rules.find((r) => r.rule_version === p.rule_version)?.document.exampleOnly
          ) {
            if (!confirm('这只是虚构示例规则，不代表学校正式政策。确认仅在明确的验证范围启用？'))
              return;
            data.acknowledgeExample = true;
          }
          await mutation(base() + '/periods/' + p.period + '/' + type, data);
          await refresh();
        });
      if (p.status === 'draft') a.append(action('activate', '激活时期'));
      if (p.status === 'active') a.append(action('freeze', '冻结榜单'));
      if (p.status !== 'draft') a.append(action('rebuild', '从账本重建'));
      return a;
    }),
  );
}
async function loadRules() {
  rules = [];
  const owner = me.schools.find((x) => x.school_id === school())?.role === 'owner';
  $('rule-form').closest('details').hidden = !owner;
  if (owner) {
    const result = await api(base() + '/rules');
    example = result.example;
    rules = result.rules;
    $('rules').replaceChildren(
      ...rules.map((r) => {
        const a = el(
          'article',
          `${r.document.label} · ${r.rule_version} · ${label[r.status]}${r.document.exampleOnly ? ' · 虚构示例' : ''}`,
        );
        if (r.status === 'draft')
          a.append(
            button('批准此规则', async () => {
              const reason = prompt('请填写审核依据（至少3字）');
              if (!reason) return;
              await mutation(base() + '/rules/' + r.rule_version + '/approve', {
                expectedRevision: r.revision,
                reason,
              });
              await loadRules();
            }),
          );
        return a;
      }),
    );
  } else {
    rules = (await api(base() + '/rules' + suffix())).rules;
  }
  $('rule-version').replaceChildren(
    ...rules
      .filter((r) => r.status === 'approved')
      .map((r) => new Option(r.document.label + ' / ' + r.rule_version, r.rule_version)),
  );
  renderPeriods();
}
async function schoolChange() {
  ++epoch;
  const schoolId = school();
  const d = await api('/m1/schools/' + encodeURIComponent(schoolId) + '/organizations');
  if (schoolId !== school()) return;
  $('org').replaceChildren(
    new Option('学校', ''),
    ...d.organizations.map((o) => {
      const n = new Option(o.name, o.org_id);
      n.dataset.role = o.role || o.membership_role || '';
      return n;
    }),
  );
  await loadRules();
  await refresh();
}
$('example').onclick = run(async () => {
  $('rule-json').value = JSON.stringify(example, null, 2);
  status('已载入虚构示例，请使用自己的版本 ID 并审核政策。');
});
$('preview').onclick = run(async () => {
  const r = await api(base() + '/rules/preview', { document: JSON.parse($('rule-json').value) });
  $('preview-result').textContent =
    (r.warnings.join('\n') || '结构有效，尚未生效。') + '\nSHA-256 ' + r.fingerprint;
});
$('rule-form').onsubmit = run(async () => {
  await mutation(base() + '/rules', { document: JSON.parse($('rule-json').value) });
  await loadRules();
  status('规则已导入为草稿，尚未生效。');
});
$('period-form').onsubmit = run(async () => {
  await mutation(base() + '/periods', {
    period: $('new-period').value,
    orgId: org() || undefined,
    semester: $('new-semester').value,
    label: $('period-label').value,
    ruleVersion: $('rule-version').value,
    startsAt: new Date($('starts').value).toISOString(),
    endsAt: new Date($('ends').value).toISOString(),
  });
  await refresh();
});
$('adjust-form').onsubmit = run(async () => {
  const b = {
    userId: $('adjust-user').value,
    orgId: org() || undefined,
    period: $('adjust-period').value,
    reason: $('adjust-reason').value,
  };
  if ($('reverse-entry').value) {
    if ($('delta').value) throw Error('独立分数与冲正原分录只能填写一项。');
    b.reversesEntryId = $('reverse-entry').value;
  } else b.delta = Number($('delta').value);
  await mutation(base() + '/adjustments', b);
  await refresh();
  status('已新增独立流水，历史记录保持不变。');
});
$('more').onclick = run(async () => {
  const query = new URLSearchParams({ after: cursor });
  if (org()) query.set('org', org());
  const v = epoch,
    r = await api(base() + '/entries?' + query);
  if (v === epoch) entryRows(r.entries, true);
});
$('refresh').onclick = run(refresh);
$('period').onchange = run(refresh);
$('school').onchange = run(schoolChange);
$('org').onchange = run(async () => {
  $('period').value = 'all';
  await loadRules();
  await refresh();
});
try {
  me = await api('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  if (!me.schools.length) throw Error('请先接受学校邀请。');
  $('starts').value = localDate(new Date());
  $('ends').value = localDate(new Date(Date.now() + 30 * 86400000));
  await schoolChange();
} catch (e) {
  status(e.message, true);
}
