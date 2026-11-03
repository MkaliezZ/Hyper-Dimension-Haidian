const $ = (id) => document.getElementById(id),
  el = (tag, text) => {
    const x = document.createElement(tag);
    if (text !== undefined) x.textContent = text;
    return x;
  };
let me,
  setup,
  packages,
  currentDocument,
  packagePreview,
  planPreview,
  selectedReport,
  activeDocument,
  pendingPlan,
  handoffRequestId,
  activeLoad = 0,
  scopeLoad = 0;
const status = (t) => ($('status').textContent = t);
const messages = {
  operations_next_version_required: '版本号必须紧接现有最新版本。',
  operations_confirmation_required: '请先确认这项操作。',
  operations_preview_confirmation_required: '材料已变化，请重新预览并确认。',
  operations_schedule_preview_stale: '范围、规则或版本发生变化，请重新预览排期。',
  operations_activation_conflict: '激活版本已被其他负责人更新，请刷新。',
  operations_active_version_conflict: '所选模板已更新，请刷新后重新安排。',
  operations_run_conflict: '交接记录已更新，请刷新复盘再操作。',
  operations_active_rule_conflict: '活动时间与当前激活的贡献规则不一致，请先核对时期设置。',
  school_owner_required: '当前学校范围需要负责人权限。',
  organization_owner_required: '当前组织范围需要负责人权限。',
  operations_future_schedule_required: '请把活动安排在尚未结束的日期。',
};
async function api(path, body) {
  const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
    d = await r.json();
  if (!r.ok) {
    const c = d.error?.code || d.error;
    throw Error(messages[c] || c || '读取失败');
  }
  return d;
}
const root = () =>
  '/operations/schools/' +
  encodeURIComponent($('school').value) +
  ($('organization').value ? '/organizations/' + encodeURIComponent($('organization').value) : '');
const run = (fn) => async (e) => {
  e?.preventDefault();
  const target = e?.currentTarget;
  if (target?.dataset.busy === 'true') return;
  if (target) target.dataset.busy = 'true';
  try {
    await fn();
  } catch (e) {
    status(e.message);
  } finally {
    if (target) delete target.dataset.busy;
  }
};
const option = (value, label) => {
  const n = el('option', label);
  n.value = value;
  return n;
};
const checkbox = (value, label, checked = false) => {
  const row = el('label');
  row.className = 'check';
  const input = el('input');
  input.type = 'checkbox';
  input.value = value;
  input.checked = checked;
  row.append(input, el('span', label));
  return row;
};
const card = (title, lines = []) => {
  const n = el('div');
  n.className = 'card';
  n.append(el('strong', title));
  for (const t of lines) n.append(el('p', t));
  return n;
};
const invalidate = () => {
  planPreview = null;
  pendingPlan = null;
  $('schedule-form').hidden = true;
  $('plan-preview').hidden = true;
};
async function loadActive() {
  const generation = ++activeLoad,
    path = root();
  invalidate();
  const h = packages.heads.find((h) => h.package_id === $('active-package').value);
  $('templates').replaceChildren();
  if (!h) {
    activeDocument = null;
    return;
  }
  const loaded = (
    await api(
      path + '/packages/' + encodeURIComponent(h.package_id) + '?version=' + h.active_version,
    )
  ).document;
  if (generation !== activeLoad || path !== root()) return;
  activeDocument = loaded;
  $('templates').replaceChildren();
  for (const t of activeDocument.templates)
    $('templates').append(
      checkbox(
        t.templateId,
        `${t.title} · 第 ${t.dayOffset} 天 · ${t.durationMinutes} 分钟 · 容量 ${t.capacity}`,
        true,
      ),
    );
}
async function loadPackages() {
  const path = root(),
    loaded = await api(path + '/packages');
  if (path !== root()) return;
  packages = loaded;
  $('packages').replaceChildren();
  for (const p of packages.packages) {
    const h = packages.heads.find((h) => h.package_id === p.package_id),
      row = card(`${p.name} · v${p.version}`, [
        p.source_label,
        (p.example_only ? '虚构示例 · ' : '') +
          (h?.active_version === p.version ? '当前已激活' : '历史或待激活版本'),
      ]);
    const view = el('button', '查看材料与差异');
    view.onclick = run(async () => {
      const d = await api(
        root() + '/packages/' + encodeURIComponent(p.package_id) + '?version=' + p.version,
      );
      $('document').value = JSON.stringify(d.document, null, 2);
      $('package-preview').hidden = false;
      $('package-preview').replaceChildren(
        card('版本档案：v' + p.version, [
          '来源：' + d.document.sourceLabel,
          '新增：' + d.diff.added.join('、'),
          '调整：' +
            d.diff.changed.map((x) => x.templateId + '(' + x.fields.join(',') + ')').join('；'),
          '旧排期不随此版本变化。',
        ]),
      );
      $('import-form').hidden = true;
      packagePreview = null;
    });
    row.append(view);
    if (h?.active_version !== p.version) {
      const activate = el('button', '激活此版本');
      const requestId = crypto.randomUUID();
      activate.onclick = run(async () => {
        if (!$('activation-confirm').checked) throw Error('请先勾选激活确认。');
        await api(root() + '/activate', {
          requestId,
          packageId: p.package_id,
          version: p.version,
          expectedRevision: h?.revision || 0,
          confirmed: true,
          reason: $('activation-reason').value,
        });
        await loadPackages();
        status('版本已明确激活，已有活动和旧排期保持原记录。');
      });
      row.append(activate);
    }
    $('packages').append(row);
  }
  if (!packages.packages.length)
    $('packages').append(el('p', '尚未导入模板，可以先预览虚构校园示例。'));
  const old = $('active-package').value;
  $('active-package').replaceChildren(
    ...packages.heads.map((h) => option(h.package_id, h.package_id + ' · v' + h.active_version)),
  );
  if (packages.heads.some((h) => h.package_id === old)) $('active-package').value = old;
  await loadActive();
}
async function loadRuns() {
  const path = root(),
    r = await api(path + '/runs');
  if (path !== root()) return;
  $('runs').replaceChildren();
  for (const x of r.items) {
    const b = el('button', x.title + ' · ' + x.package_id + ' v' + x.package_version);
    b.onclick = run(() => showReport(x.run_id));
    const row = card(x.title, ['创建于 ' + new Date(x.created_at).toLocaleString()]);
    row.append(b);
    $('runs').append(row);
  }
  if (!r.items.length) $('runs').append(el('p', '还没有排期。创建的每个活动草稿都会在这里关联。'));
}
async function showReport(id) {
  const path = root(),
    loaded = await api(path + '/runs/' + id);
  if (path !== root()) return;
  selectedReport = loaded;
  handoffRequestId = crypto.randomUUID();
  $('review').hidden = false;
  $('review-title').textContent = selectedReport.title;
  $('review-owner').textContent =
    '当前负责人：' +
    selectedReport.responsible.display_name +
    (selectedReport.currentResponsibleAuthorized ? '' : ' · 已失去管理权限，请由现负责人接手');
  $('timeline').replaceChildren();
  for (const t of selectedReport.timeline) {
    const a = t.activity,
      row = card(a.title, [
        new Date(a.starts_at).toLocaleString() + ' — ' + new Date(a.ends_at).toLocaleString(),
        `状态：${{ draft: '草稿', pending: '待审核', published: '已发布', cancelled: '已取消', rejected: '已退回' }[a.status] || a.status} · 源版本 ${a.revision}`,
        `报名状态：${t.participants.map((p) => p.status + ' ' + p.count).join('，') || '暂无报名'} · 实际贡献 ${t.contributions.delta}`,
        a.recap ? '活动回顾：' + a.recap : '尚无活动回顾。',
      ]);
    const link = el('a', '到活动中心继续审核与跟进 →');
    link.href =
      '/activities.html?school=' +
      encodeURIComponent(selectedReport.schoolId) +
      (selectedReport.orgId ? '&organization=' + encodeURIComponent(selectedReport.orgId) : '');
    link.href += '&activity=' + encodeURIComponent(t.activityId);
    row.append(link);
    $('timeline').append(row);
  }
  $('handoff-person').value = selectedReport.responsible.user_id;
  $('handoff-history').replaceChildren(
    ...selectedReport.handoffs.map((h) =>
      el('p', `${new Date(h.at).toLocaleString()} · ${h.reason}`),
    ),
  );
}
async function loadScope() {
  const generation = ++scopeLoad,
    path = root();
  ++activeLoad;
  $('workspace').hidden = true;
  packagePreview = null;
  selectedReport = null;
  $('review').hidden = true;
  $('import-form').hidden = true;
  $('package-preview').hidden = true;
  invalidate();
  const loaded = await api(path + '/setup');
  if (generation !== scopeLoad || path !== root()) return;
  setup = loaded;
  $('responsible').replaceChildren();
  $('handoff-person').replaceChildren();
  $('verifiers').replaceChildren();
  for (const p of setup.people) {
    if (p.canManage) {
      $('responsible').append(option(p.userId, p.displayName));
      $('handoff-person').append(option(p.userId, p.displayName));
    }
    $('verifiers').append(checkbox(p.userId, p.displayName, p.userId === me.userId));
  }
  if (setup.people.some((p) => p.canManage && p.userId === me.userId))
    $('responsible').value = me.userId;
  $('rule').replaceChildren(
    option('', '暂不绑定：待确认贡献规则'),
    ...setup.rules.map((r) => option(r.rule_version, r.label + ' · ' + r.rule_version)),
  );
  $('reward').replaceChildren(
    option('', '暂不关联奖励'),
    ...setup.rewards.map((r) => option(r.reward_id, r.title)),
  );
  const home = await api(path.replace('/operations/', '/community/') + '/home');
  if (generation !== scopeLoad || path !== root()) return;
  $('place').replaceChildren(
    option('', '稍后在活动草稿中指定'),
    ...home.places.map((p) =>
      option(JSON.stringify({ sceneId: p.sceneId, entityId: p.entityId }), p.label),
    ),
  );
  await Promise.all([loadPackages(), loadRuns()]);
  if (generation !== scopeLoad || path !== root()) return;
  $('workspace').hidden = false;
  status('已读取当前负责人管理范围。');
}
async function loadSchool() {
  const selected = $('school').value;
  ++scopeLoad;
  ++activeLoad;
  $('workspace').hidden = true;
  const contexts = await api(
    '/operations/schools/' + encodeURIComponent($('school').value) + '/contexts',
  );
  if (selected !== $('school').value) return;
  $('organization').replaceChildren();
  if (contexts.schoolAccessible) $('organization').append(option('', '学校运营'));
  for (const o of contexts.organizations) $('organization').append(option(o.org_id, o.name));
  if (!$('organization').options.length) {
    $('workspace').hidden = true;
    status('当前账号没有本校运营管理范围，请联系学校负责人授予必要权限。');
    return;
  }
  await loadScope();
}
$('load-example').onclick = run(async () => {
  const d = await api(root() + '/example'),
    last = Math.max(
      0,
      ...packages.packages.filter((p) => p.package_id === d.packageId).map((p) => p.version),
    );
  d.version = last + 1;
  $('document').value = JSON.stringify(d, null, 2);
  packagePreview = null;
  $('import-form').hidden = true;
  status('已读取四个虚构模板，请先校验并预览。');
});
$('package-file').onchange = run(async () => {
  const f = $('package-file').files[0];
  if (!f || f.size > 100000) throw Error('请选择小于100KB的运营JSON。');
  $('document').value = JSON.stringify(JSON.parse(await f.text()), null, 2);
  packagePreview = null;
  $('import-form').hidden = true;
  status('材料已载入，尚未导入。');
});
$('document').oninput = () => {
  packagePreview = null;
  $('import-form').hidden = true;
};
$('preview-package').onclick = run(async () => {
  currentDocument = JSON.parse($('document').value);
  packagePreview = await api(root() + '/preview', { document: currentDocument });
  packagePreview.requestId = crypto.randomUUID();
  const d = packagePreview.document;
  $('package-preview').hidden = false;
  $('package-preview').replaceChildren(
    card(d.name + ' · v' + d.version, [
      '来源：' + d.sourceLabel,
      d.exampleOnly ? '虚构示例：需要负责人确认本校安排。' : '材料标记为非示例，请核对来源。',
      `模板 ${d.templates.length} 个 · 上一版本 ${packagePreview.previousVersion || '无'}`,
      '新增：' + (packagePreview.diff.added.join('、') || '无'),
      '移除：' + (packagePreview.diff.removed.join('、') || '无'),
      '调整：' +
        (packagePreview.diff.changed
          .map((x) => x.templateId + ' ' + x.fields.join(','))
          .join('；') || '无'),
      '影响：导入0个活动、不激活规则、不发奖、不修改历史。',
    ]),
  );
  $('import-confirm').checked = false;
  $('import-form').hidden = false;
  status('校验通过，请核对变化后确认导入。');
});
$('import-form').onsubmit = run(async () => {
  if (!packagePreview) throw Error('请先预览材料。');
  await api(root() + '/import', {
    requestId: packagePreview.requestId,
    document: currentDocument,
    expectedLatestVersion: packagePreview.previousVersion,
    previewHash: packagePreview.documentHash,
    confirmed: $('import-confirm').checked,
    reason: $('import-reason').value,
  });
  $('import-form').hidden = true;
  packagePreview = null;
  await loadPackages();
  status('版本已保留，请确认是否激活供新排期使用。');
});
$('active-package').onchange = run(loadActive);
$('plan-form').oninput = invalidate;
$('plan-form').onsubmit = run(async () => {
  const h = packages.heads.find((h) => h.package_id === $('active-package').value);
  if (!h) throw Error('请先激活一个运营模板版本。');
  pendingPlan = {
    packageId: h.package_id,
    packageVersion: h.active_version,
    expectedHeadRevision: h.revision,
    title: $('plan-title').value,
    startsAt: new Date($('starts-at').value).toISOString(),
    responsibleId: $('responsible').value,
    verifierIds: [...$('verifiers').querySelectorAll('input:checked')].map((i) => i.value),
    ...($('place').value ? JSON.parse($('place').value) : { sceneId: null, entityId: null }),
    ruleVersion: $('rule').value || null,
    rewardId: $('reward').value || null,
    templateIds: [...$('templates').querySelectorAll('input:checked')].map((i) => i.value),
  };
  planPreview = await api(root() + '/runs/preview', pendingPlan);
  planPreview.requestId = crypto.randomUUID();
  $('plan-preview').hidden = false;
  $('plan-preview').replaceChildren(
    ...planPreview.slots.map((s) =>
      card(s.input.title, [
        new Date(s.input.startsAt).toLocaleString() + ' · ' + s.input.capacity + ' 人',
        s.responsibility,
      ]),
    ),
    ...planPreview.warnings.map((w) => {
      const p = el('p', w);
      p.className = 'warning';
      return p;
    }),
    el('p', `将创建 ${planPreview.slots.length} 个真实草稿，发布0个、发奖0个。`),
  );
  $('schedule-confirm').checked = false;
  $('schedule-form').hidden = false;
  status('排期已预览，尚未创建活动。');
});
$('schedule-form').onsubmit = run(async () => {
  if (!planPreview || !pendingPlan) throw Error('请先预览排期。');
  const r = await api(root() + '/runs', {
    ...pendingPlan,
    requestId: planPreview.requestId,
    previewHash: planPreview.previewHash,
    confirmed: $('schedule-confirm').checked,
  });
  invalidate();
  await loadRuns();
  await showReport(r.runId);
  status('真实活动草稿已创建；请到活动中心检查并提交审核。');
});
$('handoff-form').onsubmit = run(async () => {
  const r = await api(root() + '/runs/' + selectedReport.runId + '/handoff', {
    requestId: handoffRequestId,
    expectedRevision: selectedReport.revision,
    responsibleId: $('handoff-person').value,
    reason: $('handoff-reason').value,
  });
  await showReport(r.runId);
  status('交接已记录，账号权限仍由学校与组织授权管理。');
});
$('export').onclick = () => {
  if (!selectedReport) return;
  const a = el('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(selectedReport, null, 2)], { type: 'application/json' }),
  );
  a.download = 'operations-review-' + selectedReport.runId + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('school').onchange = run(loadSchool);
$('organization').onchange = run(loadScope);
$('refresh').onclick = run(loadScope);
window.operationsQA = {
  get preview() {
    return planPreview;
  },
  get report() {
    return selectedReport;
  },
  get packages() {
    return packages;
  },
};
try {
  me = await api('/m0/me');
  for (const s of me.schools) $('school').append(option(s.school_id, s.name || s.school_id));
  const local = new Date(Date.now() + 7 * 86400000);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  $('starts-at').value = local.toISOString().slice(0, 16);
  await loadSchool();
} catch (e) {
  $('login').hidden = false;
  status(e.message);
}
