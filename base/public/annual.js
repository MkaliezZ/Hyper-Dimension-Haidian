const $ = (id) => document.getElementById(id),
  node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
const option = (v, t) => {
  const n = node('option', t);
  n.value = v;
  return n;
};
const names = {
  objective: '客观事件',
  academic: '学业',
  career: '职业',
  life: '生活',
  community: '校园活动',
  event: '活动与服务安排',
  public: '公域资料与宣传',
  private: '私域答疑与协作',
};
let epoch = 0,
  packages = [],
  catalog = null,
  setup = null,
  mine = [],
  tasks = [],
  importPreview = null,
  planPreview = null,
  me = null,
  canManage = false;
const pending = new Map();
const selectedEntries = new Set(),
  pageSize = 24;
let pageIndex = 0;
const base = () =>
  '/annual/schools/' +
  encodeURIComponent($('school').value) +
  ($('scope').value ? '/organizations/' + encodeURIComponent($('scope').value) : '');
const operations = () => base().replace('/annual/', '/operations/');
const status = (text) => ($('status').textContent = text);
const statusNames = {
  active: '进行中',
  planned: '进行中',
  done: '已完成',
  cancelled: '已取消',
  'not-applicable': '不适用',
};
async function api(path, input) {
  const r = await fetch(path, {
    method: input ? 'POST' : 'GET',
    headers: input ? { 'Content-Type': 'application/json' } : {},
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const d = await r.json();
  if (!r.ok)
    throw Object.assign(Error(d.error?.code || d.error?.message || '操作未完成'), {
      status: r.status,
    });
  return d;
}
async function write(path, input) {
  const key = JSON.stringify([path, input]),
    requestId = pending.get(key) || crypto.randomUUID();
  pending.set(key, requestId);
  try {
    const r = await api(path, { requestId, ...input });
    pending.delete(key);
    return r;
  } catch (e) {
    if (e.status && e.status < 500) pending.delete(key);
    throw e;
  }
}
function button(text, fn) {
  const b = node('button', text);
  b.type = 'button';
  b.onclick = () => run(fn);
  return b;
}
let busyCount = 0;
async function run(fn) {
  const current = epoch;
  busyCount++;
  for (const id of ['school', 'scope', 'package', 'year']) $(id).disabled = true;
  try {
    await fn();
  } catch (e) {
    if (current === epoch) status(e.message + '；未确认结果时请刷新核对，重试会保留原请求身份。');
  } finally {
    if (--busyCount === 0)
      for (const id of ['school', 'scope', 'package', 'year']) $(id).disabled = false;
  }
}
const checked = (text) => {
  const label = node('label'),
    input = node('input');
  input.type = 'checkbox';
  label.append(input, document.createTextNode(text));
  return { label, input };
};
function input(label, type, value = '') {
  const l = node('label', label),
    i = node('input');
  i.type = type;
  i.value = value;
  l.append(i);
  return { label: l, input: i };
}
function select(label, values, current) {
  const l = node('label', label),
    s = node('select');
  s.replaceChildren(...values.map(([v, t]) => option(v, t)));
  s.value = current;
  l.append(s);
  return { label: l, input: s };
}
const dateValue = (v) =>
  v
    ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
const dateInput = (i) => (i.value ? new Date(i.value).toISOString() : null);
function reset() {
  selectedEntries.clear();
  pageIndex = 0;
  $('selected-count').textContent = '已选 0 项';
  $('page-position').textContent = '';
  $('previous-page').disabled = true;
  $('next-page').disabled = true;
  catalog = null;
  planPreview = null;
  importPreview = null;
  mine = [];
  tasks = [];
  setup = null;
  for (const id of [
    'entries',
    'mine',
    'tasks',
    'counts',
    'assumptions',
    'plan-preview',
    'import-preview',
  ])
    $(id).replaceChildren();
  $('confirm-plan').checked = false;
  $('confirm-import').checked = false;
  $('confirm-activate').checked = false;
}
async function scopes() {
  const current = ++epoch;
  reset();
  $('management').hidden = true;
  const r = await api('/annual/schools/' + encodeURIComponent($('school').value) + '/contexts');
  if (current !== epoch) return;
  $('scope').replaceChildren(
    ...(r.schoolAccessible ? [option('', '全校')] : []),
    ...r.organizations.map((x) => option(x.org_id, x.name)),
  );
  await load();
}
async function load() {
  const current = ++epoch;
  reset();
  const path = base(),
    r = await api(path + '/packages');
  if (current !== epoch) return;
  packages = r.packages;
  canManage = r.canManage;
  $('management').hidden = !canManage;
  const active = [
    ...new Map(
      packages.filter((x) => x.version === x.active_version).map((x) => [x.package_id, x]),
    ).values(),
  ];
  $('package').replaceChildren(
    ...active.map((x) => option(x.package_id, x.name + ' · v' + x.active_version)),
  );
  $('version').replaceChildren(
    ...packages.map((x) =>
      option(
        x.package_id + ':' + x.version,
        x.name + ' · v' + x.version + (x.version === x.active_version ? '（已启用）' : ''),
      ),
    ),
  );
  if (canManage) {
    setup = await api(operations() + '/setup');
    if (current !== epoch) return;
    $('owner').replaceChildren(
      ...setup.people.filter((x) => x.canManage).map((x) => option(x.userId, x.displayName)),
    );
    if (setup.people.some((x) => x.userId === me.userId && x.canManage))
      $('owner').value = me.userId;
    await loadTasks();
  }
  await loadMine();
  if (active.length) await loadCatalog();
  else
    status(
      canManage
        ? '尚无启用资料，请导入、核对并启用。'
        : '负责人尚未启用年度资料；你自己的清单仍保留。',
    );
}
async function loadCatalog() {
  const current = epoch,
    path = base(),
    id = $('package').value;
  if (!id) return;
  const c = await api(path + '/catalog?packageId=' + encodeURIComponent(id));
  if (current !== epoch) return;
  catalog = c;
  $('cohort').replaceChildren(
    option('', '全部年级'),
    ...c.cohorts.map((x) => option(x.id, x.name)),
  );
  $('month').replaceChildren(
    option('', '全部月份'),
    ...Array.from({ length: 12 }, (_, i) => ((c.startMonth + i - 1) % 12) + 1).map((m) =>
      option(String(m), m + '月'),
    ),
  );
  const context = node('details');
  context.append(
    node('summary', '适用范围、分支与资料口径（' + c.assumptions.length + ' 条）'),
    ...c.assumptions.map((x) => node('p', x)),
  );
  $('assumptions').replaceChildren(context);
  selectedEntries.clear();
  pageIndex = 0;
  planPreview = null;
  $('confirm-plan').checked = false;
  renderEntries();
  status('参考资料已载入。请选择适用情境；不会自动建立任务。');
}
function renderEntries() {
  if (!catalog) return;
  planPreview = null;
  $('plan-preview').textContent = '';
  $('confirm-plan').checked = false;
  const entries = catalog.entries.filter(
    (x) =>
      (!$('cohort').value || x.cohortIds.includes($('cohort').value)) &&
      (!$('month').value || x.month === Number($('month').value)) &&
      (!$('category').value || x.category === $('category').value) &&
      (!$('channel').value || x.channel === $('channel').value),
  );
  $('counts').textContent =
    entries.length + ' 个参考情境；原资料 ' + catalog.originalEntryCount + ' 条，不代表必做任务。';
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  pageIndex = Math.min(pageIndex, pageCount - 1);
  $('page-position').textContent =
    '第 ' + (pageIndex + 1) + ' / ' + pageCount + ' 页，每页最多 ' + pageSize + ' 项';
  $('previous-page').disabled = pageIndex === 0;
  $('next-page').disabled = pageIndex >= pageCount - 1;
  $('selected-count').textContent =
    '已选 ' + selectedEntries.size + ' 项（含其他页或筛选范围中的选择）';
  $('entries').replaceChildren(
    ...entries.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((e) => {
      const a = node('article');
      a.dataset.entry = e.entryId;
      a.append(
        node('h3', e.month + '月 · ' + e.title),
        node('p', names[e.category] + ' · ' + names[e.channel] + ' · Base-' + e.targetBase),
      );
      a.append(node('p', e.description || e.studentNeed));
      const detail = node('details'),
        summary = node('summary', '适用条件、时间窗口与来源');
      detail.append(summary);
      const dl = node('dl');
      for (const [k, title] of [
        ['studentNeed', '学生需求'],
        ['applicability', '适用条件'],
        ['eventWindow', '发生窗口'],
        ['bestWindow', '准备或需求窗口'],
        ['processWindow', '持续过程'],
        ['directImpact', '直接影响阶段'],
        ['downstream', '条件性后续影响'],
      ])
        if (e[k]) dl.append(node('dt', title), node('dd', e[k]));
      if (e.familyNeed)
        dl.append(node('dt', '可选的家庭支持情境，由学生自行决定'), node('dd', e.familyNeed));
      detail.append(dl);
      for (const ref of catalog.references.filter((x) => e.sourceRefs.includes(x.id))) {
        const p = node('p'),
          link = node('a', ref.title);
        if (ref.url) {
          link.href = ref.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        p.append(
          link,
          document.createTextNode(
            ' · ' + ref.scope + ' · 来源核对时间 ' + (ref.checkedAt || '待核对'),
          ),
        );
        detail.append(p);
      }
      a.append(detail);
      const old = mine.find(
          (x) =>
            x.package_id === catalog.packageId &&
            x.academic_year === Number($('year').value) &&
            x.chain_id === e.chainId,
        ),
        priority = select(
          '由我判断当前等级',
          [
            ['', '不评级'],
            ['A', 'A 重要且紧急'],
            ['B', 'B 重要不紧急'],
            ['C', 'C 有时限但相对次要'],
          ],
          old?.priority || '',
        ),
        due = input('我的实际截止时间（可不填）', 'datetime-local', dateValue(old?.due_at));
      priority.input.disabled = e.category === 'objective';
      a.append(
        node(
          'p',
          e.category === 'objective'
            ? '客观事件不评级。'
            : '资料建议：' + (e.suggestedPriority || '未评级') + '；请按本人当前情况决定。',
        ),
        priority.label,
        due.label,
      );
      const consent = checked('这项情境对我适用，我自愿加入或更新自己的计划');
      a.append(
        consent.label,
        button(old ? '更新我的计划' : '加入我的计划', async () => {
          if (!consent.input.checked) throw Error('请确认这项情境当前适用。');
          await write(base() + '/mine', {
            packageId: catalog.packageId,
            academicYear: Number($('year').value),
            entryId: e.entryId,
            expectedRevision: old?.revision || 0,
            confirmed: true,
            status: 'active',
            priority: priority.input.value || null,
            dueAt: dateInput(due.input),
          });
          await loadMine();
          renderEntries();
          status('已保存你的个人计划，没有发布或计分。');
        }),
      );
      if (canManage) {
        const choice = checked('选入学生会运营分工');
        choice.input.dataset.planEntry = e.entryId;
        choice.input.checked = selectedEntries.has(e.entryId);
        a.append(choice.label);
      }
      return a;
    }),
  );
}
const selectionQuery = () =>
  new URLSearchParams({
    academicYear: $('year').value,
    ...($('package').value ? { packageId: $('package').value } : {}),
  }).toString();
async function loadMine() {
  const current = epoch,
    selection = selectionQuery(),
    r = await api(base() + '/mine?' + selection);
  if (current !== epoch || selection !== selectionQuery()) return;
  mine = r.items;
  $('mine').replaceChildren(
    ...mine.map((x) => {
      const a = node('article');
      a.append(
        node('h3', x.snapshot.title),
        node(
          'p',
          x.academic_year + ' 学年 · ' + statusNames[x.status] + ' · ' + (x.priority || '不评级'),
        ),
      );
      for (const [state, label] of [
        ['done', '已完成，解除评级'],
        ['not-applicable', '不适用，解除评级'],
      ])
        a.append(
          button(label, async () => {
            await write(base() + '/mine', {
              packageId: x.package_id,
              academicYear: x.academic_year,
              entryId: x.entry_id,
              expectedRevision: x.revision,
              confirmed: true,
              status: state,
              priority: null,
              dueAt: x.due_at,
            });
            await loadMine();
            renderEntries();
            status('个人状态已更新。');
          }),
        );
      a.append(
        button('从我的清单删除', async () => {
          await write(base() + '/mine/remove', {
            packageId: x.package_id,
            academicYear: x.academic_year,
            chainId: x.chain_id,
            expectedRevision: x.revision,
            confirmed: true,
          });
          await loadMine();
          renderEntries();
          status('已从你的清单删除。');
        }),
      );
      return a;
    }),
  );
}
async function loadTasks() {
  const current = epoch,
    selection = selectionQuery(),
    r = await api(base() + '/tasks?' + selection);
  if (current !== epoch || selection !== selectionQuery()) return;
  tasks = r.tasks;
  $('tasks').replaceChildren(
    ...tasks.map((t) => {
      const a = node('article');
      a.dataset.task = t.task_id;
      a.append(
        node('h3', t.period + ' · ' + t.snapshot.title),
        node(
          'p',
          names[t.snapshot.channel] + ' · v' + t.package_version + ' · ' + statusNames[t.status],
        ),
      );
      const owners = setup.people.filter((x) => x.canManage).map((x) => [x.userId, x.displayName]),
        owner = select('当前负责人', owners, t.owner_id),
        state = select(
          '运营事项状态',
          [
            ['planned', '进行中'],
            ['done', '已完成'],
            ['cancelled', '已取消'],
          ],
          t.status,
        ),
        due = input('核对后的实际开始或截止时间', 'datetime-local', dateValue(t.due_at)),
        official = input('日期依据的官方 HTTPS 入口（如有）', 'url', t.official_url || ''),
        verified = checked('已按本校当前日历核对这一实际日期'),
        refresh = checked('本次明确复核并采用当前启用资料的同一情境'),
        reason = input('处理或交接理由', 'text');
      verified.input.checked = t.date_verified;
      a.append(
        owner.label,
        state.label,
        due.label,
        official.label,
        verified.label,
        refresh.label,
        reason.label,
        button('保存分工与日期', async () => {
          await write(base() + '/tasks/' + t.task_id, {
            expectedRevision: t.revision,
            ownerId: owner.input.value,
            status: state.input.value,
            dueAt: dateInput(due.input),
            dateVerified: verified.input.checked,
            officialUrl: official.input.value || null,
            refreshSource: refresh.input.checked,
            reason: reason.input.value,
          });
          await loadTasks();
          status('已保存分工与核对日期；没有创建或发布活动。');
        }),
      );
      if (t.snapshot.channel === 'event' && !t.activity_id) {
        const duration = input('活动时长（分钟）', 'number', '60'),
          capacity = input('活动人数上限', 'number', '30'),
          confirm = checked('我确认用已保存的日期、地点范围与负责人建立活动草稿');
        a.append(
          duration.label,
          capacity.label,
          confirm.label,
          button('另行创建活动草稿', async () => {
            if (!confirm.input.checked || !t.date_verified || !t.due_at)
              throw Error('请先保存核对后的日期，再确认创建活动草稿。');
            const startsAt = new Date(t.due_at).toISOString(),
              endsAt = new Date(
                Date.parse(startsAt) + Number(duration.input.value) * 60000,
              ).toISOString();
            const result = await write(base() + '/tasks/' + t.task_id + '/activity', {
              expectedRevision: t.revision,
              confirmed: true,
              input: {
                kind: 'event',
                startsAt,
                endsAt,
                registrationClosesAt: startsAt,
                capacity: Number(capacity.input.value),
                remindBeforeMinutes: 60,
                verifierIds: [t.owner_id],
                sceneId: null,
                entityId: null,
                tasks: [],
              },
            });
            await loadTasks();
            status('活动草稿已建立，请到活动中心编辑地点、审核并发布。');
          }),
        );
      }
      const link = node(
        'a',
        t.activity_id
          ? '打开活动草稿'
          : t.snapshot.targetBase === 4
            ? '查看合作服务'
            : t.snapshot.targetBase === 1 && t.snapshot.channel === 'public'
              ? '准备已审核接待资料'
              : t.snapshot.channel === 'public'
                ? '打开论坛与公域内容入口'
                : '打开私信与讨论入口',
      );
      link.className = 'action';
      link.href = t.activity_id
        ? '/activities.html?school=' +
          encodeURIComponent($('school').value) +
          (t.scope_id ? '&organization=' + encodeURIComponent(t.scope_id) : '') +
          '&activity=' +
          t.activity_id
        : t.snapshot.targetBase === 4
          ? '/partners.html?school=' + encodeURIComponent($('school').value)
          : t.snapshot.targetBase === 1 && t.snapshot.channel === 'public'
            ? '/knowledge.html'
            : t.snapshot.channel === 'public'
              ? '/community.html'
              : '/social.html';
      a.append(link);
      return a;
    }),
  );
}
$('filters').onsubmit = (e) => {
  e.preventDefault();
  pageIndex = 0;
  renderEntries();
};
$('previous-page').onclick = () => {
  pageIndex = Math.max(0, pageIndex - 1);
  renderEntries();
};
$('next-page').onclick = () => {
  pageIndex++;
  renderEntries();
};
$('clear-selection').onclick = () => {
  selectedEntries.clear();
  planPreview = null;
  $('confirm-plan').checked = false;
  $('plan-preview').replaceChildren();
  renderEntries();
};
$('school').onchange = () => run(scopes);
$('scope').onchange = () => run(load);
$('package').onchange = () =>
  run(async () => {
    $('tasks').replaceChildren();
    $('mine').replaceChildren();
    await loadMine();
    await loadCatalog();
    if (canManage) await loadTasks();
  });
$('year').onchange = () =>
  run(async () => {
    selectedEntries.clear();
    pageIndex = 0;
    planPreview = null;
    $('confirm-plan').checked = false;
    $('plan-preview').replaceChildren();
    $('tasks').replaceChildren();
    $('mine').replaceChildren();
    await loadMine();
    renderEntries();
    if (canManage) await loadTasks();
  });
$('refresh-mine').onclick = () =>
  run(async () => {
    await loadMine();
    renderEntries();
  });
$('example').onclick = () =>
  run(async () => {
    $('document').value = JSON.stringify(await api(base() + '/example'), null, 2);
    importPreview = null;
  });
$('file').onchange = () =>
  run(async () => {
    const f = $('file').files[0];
    if (!f) return;
    if (f.size > 3500000) throw Error('请拆分超过 3.5 MB 的资料。');
    $('document').value = await f.text();
    importPreview = null;
    $('confirm-import').checked = false;
  });
$('document').oninput = () => {
  importPreview = null;
  $('confirm-import').checked = false;
};
$('preview-import').onclick = () =>
  run(async () => {
    importPreview = await api(base() + '/preview', { document: JSON.parse($('document').value) });
    $('import-preview').textContent = JSON.stringify(
      {
        previousVersion: importPreview.previousVersion,
        diff: importPreview.diff,
        effects: importPreview.effects,
      },
      null,
      2,
    );
    status('请核对变化，确认后导入。');
  });
$('import').onclick = () =>
  run(async () => {
    if (!importPreview || !$('confirm-import').checked) throw Error('请先预览并确认资料。');
    await write(base() + '/import', {
      document: importPreview.document,
      previewHash: importPreview.documentHash,
      expectedLatestVersion: importPreview.previousVersion,
      confirmed: true,
      reason: $('reason').value,
    });
    await load();
    status('新版本已导入，尚未启用。');
  });
$('activate').onclick = () =>
  run(async () => {
    const p = packages.find((x) => x.package_id + ':' + x.version === $('version').value);
    if (!p || !$('confirm-activate').checked) throw Error('请选择版本并确认启用。');
    await write(base() + '/activate', {
      packageId: p.package_id,
      version: p.version,
      expectedRevision: p.head_revision || 0,
      confirmed: true,
      reason: $('reason').value,
    });
    await load();
    status('已启用审核后的版本，旧计划保持原样。');
  });
$('preview-plan').onclick = () =>
  run(async () => {
    const plan = {
      packageId: $('package').value,
      academicYear: Number($('year').value),
      entryIds: [...selectedEntries],
      ownerId: $('owner').value,
    };
    const result = await api(base() + '/tasks/preview', plan);
    if (
      JSON.stringify(plan.entryIds) !== JSON.stringify([...selectedEntries]) ||
      plan.ownerId !== $('owner').value
    )
      throw Error('选择已变化，请重新预览。');
    planPreview = { input: plan, result };
    $('plan-preview').textContent = JSON.stringify(
      {
        entries: planPreview.result.entries.map((x) => ({
          title: x.entry.title,
          period: x.period,
          channel: names[x.entry.channel],
        })),
        effects: planPreview.result.effects,
      },
      null,
      2,
    );
  });
$('owner').onchange = () => {
  planPreview = null;
  $('confirm-plan').checked = false;
};
$('entries').onchange = (e) => {
  if (e.target.dataset.planEntry) {
    const id = e.target.dataset.planEntry;
    if (e.target.checked) {
      if (selectedEntries.size >= 100) {
        e.target.checked = false;
        status('每次最多安排 100 项，请先预览并提交当前选择。');
        return;
      }
      selectedEntries.add(id);
    } else selectedEntries.delete(id);
    $('selected-count').textContent =
      '已选 ' + selectedEntries.size + ' 项（含其他页或筛选范围中的选择）';
    planPreview = null;
    $('confirm-plan').checked = false;
  }
};
$('commit-plan').onclick = () =>
  run(async () => {
    if (!planPreview || !$('confirm-plan').checked) throw Error('请先预览并确认学年分工。');
    await write(base() + '/tasks', {
      plan: planPreview.input,
      previewHash: planPreview.result.previewHash,
      confirmed: true,
    });
    planPreview = null;
    selectedEntries.clear();
    renderEntries();
    await loadTasks();
    status('运营事项已建立；没有自动发布活动、论坛内容或奖励。');
  });
$('year').value = new Date().getFullYear();
api('/m0/me')
  .then(async (r) => {
    me = r;
    const schools = r.schools.filter((x) => x.modules?.base3 !== false);
    $('school').replaceChildren(...schools.map((x) => option(x.school_id, x.school_id)));
    if (!schools.length) throw Error('请先登录并加入学校。');
    await run(scopes);
  })
  .catch((e) => status(e.message));
