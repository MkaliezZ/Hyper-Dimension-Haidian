const $ = (id) => document.getElementById(id),
  node = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  };
let schools = [],
  requestId = null,
  pendingInput = null,
  epoch = 0;
const path = () =>
  '/agent-business/schools/' + encodeURIComponent($('school').value) + '/delegations';
async function api(url, input) {
  const r = await fetch(url, {
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
  $('services').replaceChildren();
  $('grants').replaceChildren();
  $('token').value = '';
  $('secret').hidden = true;
  requestId = null;
  pendingInput = null;
  for (const input of $('grant').querySelectorAll('input,select')) input.disabled = false;
  const selected = $('school').value;
  const [directory, list] = await Promise.all([
    api('/m5/schools/' + encodeURIComponent(selected) + '/directory'),
    api(path()),
  ]);
  if (current !== epoch) return;
  $('services').replaceChildren(
    ...directory.sources.map((s) => {
      const label = node('label', s.title);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.name = 'service';
      box.value = s.serviceId;
      box.checked = new URLSearchParams(location.search).get('service') === s.serviceId;
      label.prepend(box);
      return label;
    }),
  );
  $('grants').replaceChildren(
    ...list.delegations.map((g) => {
      const el = node(
        'article',
        g.label + ' · ' + new Date(g.expiresAt).toLocaleString() + (g.revokedAt ? ' · 已撤销' : ''),
      );
      if (!g.revokedAt) {
        const b = node('button', '撤销');
        b.type = 'button';
        const id = crypto.randomUUID();
        b.onclick = () =>
          api(path() + '/' + g.delegationId + '/revoke', { requestId: id })
            .then(refresh)
            .catch(show);
        el.append(b);
      }
      return el;
    }),
  );
  $('status').textContent = '选择授权范围后创建。';
}
function show(e) {
  $('status').textContent = e.message;
}
$('clear').onclick = () => {
  $('token').value = '';
  $('secret').hidden = true;
};
$('school').onchange = () => refresh().catch(show);
$('grant').onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  const current = epoch,
    selectedSchool = $('school').value;
  try {
    requestId ??= crypto.randomUUID();
    pendingInput ??= {
      requestId,
      label: $('label').value,
      serviceIds: [...document.querySelectorAll('[name=service]:checked')].map((x) => x.value),
      skills: [...document.querySelectorAll('[name=skill]:checked')].map((x) => x.value),
      expiresAt: new Date(Date.now() + Number($('hours').value) * 3600000).toISOString(),
      confirmed: $('confirmed').checked,
    };
    for (const input of $('grant').querySelectorAll('input,select')) input.disabled = true;
    const result = await api(path(), pendingInput);
    if (current !== epoch) return;
    await refresh();
    if (result.token) {
      $('token').value = result.token;
      $('secret').hidden = false;
      $('endpoint').textContent =
        location.origin +
        '/agents/' +
        schools.find((s) => s.school_id === selectedSchool).space_id +
        '-partner-services/.well-known/agent-card.json';
    } else $('status').textContent = '授权已创建，令牌不重复显示。若未保存，请撤销后重新创建。';
  } catch (err) {
    if (current !== epoch) return;
    if (err.status && err.status < 500) {
      pendingInput = null;
      requestId = null;
      for (const input of $('grant').querySelectorAll('input,select')) input.disabled = false;
    }
    $('status').textContent =
      err.message +
      '。此次输入已保留，可重试同一次授权；若授权已建立而未收到令牌，请刷新列表撤销后再创建。';
  } finally {
    button.disabled = false;
  }
};
api('/m0/me')
  .then(async (me) => {
    schools = me.schools.filter((s) => s.modules?.base4 !== false);
    $('school').replaceChildren(
      ...schools.map((s) => {
        const o = node('option', s.school_id);
        o.value = s.school_id;
        return o;
      }),
    );
    const requested = new URLSearchParams(location.search).get('school');
    if (requested) {
      if (!schools.some((s) => s.school_id === requested))
        throw Error('当前账号没有指定学校权限。');
      $('school').value = requested;
    }
    if (!schools.length) throw Error('没有可授权的学校；请先登录加入学校。');
    $('grant').hidden = false;
    await refresh();
  })
  .catch(show);
