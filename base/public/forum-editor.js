const $ = (id) => document.getElementById(id),
  q = new URLSearchParams(location.search),
  school = q.get('school'),
  org = q.get('org'),
  id = q.get('id');
const root =
  '/m1/schools/' +
  encodeURIComponent(school) +
  (org ? '/organizations/' + encodeURIComponent(org) : '') +
  '/forum';
let item;
async function api(body) {
  const r = await fetch(root, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    d = await r.json();
  if (!r.ok) throw Error(d.error?.message || d.error?.code || '请求失败');
  return d;
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn();
  } catch (e) {
    $('status').textContent = e.message;
  }
};
async function load() {
  item = await api({ action: 'detail', id });
  $('heading').textContent = item.title;
  $('published').textContent = item.content ?? '当前内容已撤回或尚未发布。';
  $('version').textContent =
    '版本 ' +
    item.revision +
    ' · ' +
    ({ pending: '待审', published: '已发布', withdrawn: '已撤回', rejected: '未提交' }[
      item.status
    ] || item.status);
  $('title').value = item.title;
  $('content').value = item.content || '';
  $('editPanel').hidden = !item.canEdit || Boolean(item.draft);
  $('draftPanel').hidden = !item.draft;
  $('moderation').replaceChildren();
  $('reply').hidden = item.status !== 'published' || Boolean(item.parentId);
  if (item.draft) {
    $('draft').textContent = item.draft.title + '\n\n' + item.draft.content;
    if (item.canModerate)
      for (const action of ['approve-edit', 'reject-edit']) {
        const b = document.createElement('button');
        b.textContent = action === 'approve-edit' ? '审核更新原帖' : '驳回修订';
        b.onclick = run(async () => {
          await api({
            action,
            id,
            draftId: item.draft.id,
            expectedRevision: item.revision,
            requestId: crypto.randomUUID(),
          });
          await load();
        });
        $('moderation').append(b);
      }
  }
  $('status').textContent = '已读取当前版本。';
}
$('edit').onsubmit = run(async () => {
  const b = {
    action: 'edit',
    id,
    requestId: crypto.randomUUID(),
    expectedRevision: item.revision,
    title: $('title').value,
    content: $('content').value,
  };
  await api(b);
  await load();
  $('status').textContent = '修订已进入审核，已发布原帖保持当前版本。';
});
$('reply').onsubmit = run(async () => {
  await api({
    action: 'submit',
    parentId: id,
    title: '回复：' + item.title.slice(0, 70),
    content: $('replyContent').value,
    requestId: crypto.randomUUID(),
  });
  $('replyContent').value = '';
  $('status').textContent = '回复已进入审核队列。';
});
await run(load)();
