const $ = (id) => document.getElementById(id);
let version = 0,
  pending = null,
  epoch = 0;
const root = () => '/knowledge-admin/schools/' + encodeURIComponent($('school').value);
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
async function refresh() {
  const current = ++epoch;
  pending = null;
  $('publish').hidden = true;
  $('documents').value = '';
  $('index').textContent = '';
  try {
    const [d, s] = await Promise.all([api(root() + '/documents'), api(root() + '/status')]);
    if (current !== epoch) return;
    version = d.version;
    $('documents').value = JSON.stringify(d.documents, null, 2);
    $('confirmed').checked = false;
    $('publish').hidden = false;
    $('index').textContent = JSON.stringify(s, null, 2);
    $('status').textContent =
      '当前公开版本 ' + version + '；发布后自动更新，旧版本被撤回的内容立即停止引用。';
  } catch (e) {
    if (current === epoch) $('status').textContent = '当前账号无法管理此学校公开资料：' + e.message;
  }
}
$('school').onchange = refresh;
$('refresh').onclick = refresh;
$('file').onchange = async () => {
  try {
    const file = $('file').files[0];
    if (!file) return;
    if (file.size > 4194304) throw Error('请将资料分批整理到 4MB 以内。');
    const docs = JSON.parse(await file.text());
    if (!Array.isArray(docs)) throw Error('JSON 顶层应为数组。');
    $('documents').value = JSON.stringify(docs, null, 2);
    pending = null;
  } catch (e) {
    $('status').textContent = e.message;
  }
};
$('publish').onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    pending ??= {
      requestId: crypto.randomUUID(),
      expectedVersion: version,
      documents: JSON.parse($('documents').value),
      confirmed: $('confirmed').checked,
    };
    const result = await api(root() + '/documents', pending);
    await refresh();
    $('status').textContent = '公开版本 ' + result.version + ' 已保存，正在自动更新索引。';
  } catch (err) {
    if (err.status && err.status < 500) pending = null;
    $('status').textContent =
      '未确认完成：' + err.message + '；连接中断时重试同一次发布，版本冲突时请刷新核对。';
  } finally {
    button.disabled = false;
  }
};
api('/m0/me')
  .then(async (me) => {
    for (const s of me.schools.filter((s) => s.role === 'owner')) {
      const option = document.createElement('option');
      option.value = s.school_id;
      option.textContent = s.school_id;
      $('school').append(option);
    }
    if (!$('school').options.length) throw Error('需要学校负责人账号。');
    await refresh();
  })
  .catch((e) => ($('status').textContent = e.message));
