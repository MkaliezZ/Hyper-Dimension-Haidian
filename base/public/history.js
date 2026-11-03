const $ = (id) => document.getElementById(id),
  el = (tag, text) => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };
let epoch = 0;
async function api(path, input) {
  const r = await fetch(path, {
    method: input ? 'POST' : 'GET',
    headers: input ? { 'Content-Type': 'application/json' } : {},
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error?.code || d.error?.message || '查询未完成');
  return d;
}
const option = (value, label) => {
  const n = el('option', label);
  n.value = value;
  return n;
};
function clear() {
  epoch++;
  $('results').replaceChildren();
}
async function context() {
  clear();
  const c = await api('/community/schools/' + encodeURIComponent($('school').value) + '/contexts');
  $('org').replaceChildren(
    ...(c.schoolAccessible ? [option('', '全校社区')] : []),
    ...c.organizations.map((o) => option(o.org_id, o.name)),
  );
}
$('school').onchange = () => context().catch((e) => ($('status').textContent = e.message));
$('org').onchange = clear;
$('search').onsubmit = async (e) => {
  e.preventDefault();
  clear();
  const current = epoch;
  $('status').textContent = '正在核对索引与原始论坛权限…';
  try {
    const r = await api(
      '/history-index/schools/' + encodeURIComponent($('school').value) + '/search',
      {
        query: $('query').value,
        orgId: $('org').value || null,
        includeHistory: $('history').checked,
      },
    );
    if (current !== epoch) return;
    $('results').replaceChildren(
      ...r.items.map((x) => {
        const n = document.createElement('article');
        n.append(
          el('h2', x.title),
          el(
            'p',
            x.historical
              ? '历史审核版本 ' + x.revision + '（当前 ' + x.currentRevision + '）'
              : '当前审核版本 ' + x.revision,
          ),
          el('p', x.body),
          el('small', '来源 ' + x.sourceId + (x.baseline ? ' · 已有内容基线' : '')),
        );
        return n;
      }),
    );
    $('status').textContent = r.items.length
      ? '已按当前权限与来源状态核对。'
      : '暂无可用结果；新发布内容完成索引后可检索。';
  } catch (err) {
    if (current === epoch) $('status').textContent = err.message;
  }
};
api('/m0/me')
  .then(async (me) => {
    $('school').replaceChildren(...me.schools.map((s) => option(s.school_id, s.school_id)));
    if (!me.schools.length) throw Error('请登录并加入学校。');
    await context();
    $('search').hidden = false;
    $('status').textContent = '输入内容或相关语义开始检索。';
  })
  .catch((e) => ($('status').textContent = e.message));
