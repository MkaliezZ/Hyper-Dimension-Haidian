const $ = (id) => document.getElementById(id),
  node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
const labels = {
    'reception-agent': '接待 Agent · A2A',
    'activity-workflow': '活动流程助手 · 用户操作',
    'partner-workflow': '合作流程助手 · 用户确认',
    'partner-business-agent': '合作服务 Agent · A2A 委托',
  },
  skills = {
    'space.information': '公开资料问答与注明性质的通用交流',
    'navigation.route': '空间内通行路线',
    'message.leave': '用户主动给维护者留言',
    'activity.read': '读取当前获准活动安排',
    'activity.participation': '进入活动页，由本人确认参与',
    'partner.service.read': '读取当前审核通过的服务资料',
    'partner.request.propose': '进入办理页，核对接收方、字段和授权后确认',
    'partner.services.list': '在授权服务范围内查询目录',
    'partner.service.get': '读取已审核服务详情',
    'partner.task.propose': '准备待本人确认的咨询或预约',
    'partner.task.get': '在明确授权后查询本人的办理记录',
    'partner.task.cancel': '在授权范围内取消本人的申请',
  };
let me,
  cards = [];
const base = () => '/agent-directory/schools/' + encodeURIComponent($('school').value);
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
async function get(path) {
  const r = await fetch(path);
  const b = await r.json();
  if (!r.ok)
    throw Object.assign(
      Error(
        r.status === 401
          ? '请先登录学校账号。'
          : r.status === 403
            ? '当前账号没有该学校或组织权限。'
            : r.status === 404
              ? '这项服务已撤回、到期或不再可见。'
              : '当前服务暂不可用，请稍后核对。',
      ),
      { status: r.status },
    );
  return b;
}
function safeLink(label, path) {
  const a = node('a', label);
  a.href = path;
  return a;
}
function render() {
  const q = $('search').value.trim().toLowerCase(),
    kind = $('kind').value,
    selected = cards.filter(
      (c) => (!kind || c.kind === kind) && (c.name + ' ' + c.description).toLowerCase().includes(q),
    );
  $('summary').textContent = `${selected.length} 项当前可见服务。流程助手不代表已授权自动代办。`;
  $('cards').replaceChildren(
    ...selected.map((card) => {
      const article = node('article');
      article.className = 'card';
      article.dataset.agentId = card.id;
      article.append(
        node('p', labels[card.kind]),
        node('h2', card.name),
        node('p', card.description),
      );
      const list = node('ul');
      list.className = 'capabilities';
      for (const s of card.capabilities) list.append(node('li', skills[s.id] || s.id));
      article.append(list);
      const responsible = node(
        'p',
        '维护职责：' +
          card.maintainer.label +
          (card.maintainer.assigned
            ? ' · 当前已设负责人'
            : card.maintainer.schoolEscalationAvailable
              ? ' · 本岗位待指定，可联系学校负责人'
              : ' · 尚未指定，请先联系部署维护者'),
      );
      responsible.className = 'maintainer';
      article.append(responsible);
      const detail = node('details');
      detail.append(node('summary', '查看信息来源和身份'));
      detail.append(node('p', '身份编号：' + card.id));
      for (const s of card.sources)
        detail.append(
          node(
            'p',
            `${s.kind} / ${s.id} / 版本 ${s.revision}${s.validUntil ? ' / 有效至 ' + new Date(s.validUntil).toLocaleString('zh-CN') : ''}`,
          ),
        );
      if (card.agentCardUrl) detail.append(safeLink('查看实际 A2A Agent Card', card.agentCardUrl));
      detail.append(
        node(
          'p',
          card.delegatedExecution
            ? '本人明确授权后可查询、准备申请和取消；转交个人资料仍由本人确认。不能提高权限或发奖。'
            : '此入口不自动代表用户执行。不能自行提高权限或发奖。',
        ),
      );
      article.append(detail);
      const actions = node('div');
      actions.className = 'actions';
      for (const action of card.actions) {
        const button = node('button', action.label);
        button.className = 'primary';
        button.onclick = async () => {
          button.disabled = true;
          try {
            const fresh = await get(base() + '/cards/' + encodeURIComponent(card.id));
            const current = fresh.actions.find((a) => a.label === action.label);
            if (!current) throw Error('当前入口已变更，请刷新。');
            location.assign(current.href);
          } catch (e) {
            status(e.message, true);
          } finally {
            button.disabled = false;
          }
        };
        actions.append(button);
        article.append(node('p', action.confirmation));
      }
      article.append(actions);
      return article;
    }),
  );
  if (!selected.length)
    $('cards').append(
      node('p', '当前没有匹配的服务。未发布、已撤回和不在获准范围内的内容不会显示。'),
    );
}
async function load() {
  window.agentsQA = { ready: false };
  $('school').disabled = true;
  try {
    const response = await get(base());
    cards = response.cards;
    render();
    $('workspace').hidden = false;
    window.agentsQA = { ready: true, school: $('school').value };
    status('已按当前权限核对服务、来源与维护职责。');
  } catch (e) {
    $('workspace').hidden = true;
    status(e.message, true);
  } finally {
    $('school').disabled = false;
  }
}
$('school').onchange = load;
$('refresh').onclick = load;
$('search').oninput = render;
$('kind').onchange = render;
try {
  me = await get('/m0/me');
  $('school').replaceChildren(...me.schools.map((s) => new Option(s.school_id, s.school_id)));
  const params = new URLSearchParams(location.search),
    requested = params.get('school'),
    space = params.get('space');
  if (requested && !me.schools.some((s) => s.school_id === requested))
    throw Error('当前账号没有链接所指学校的权限。');
  if (requested) $('school').value = requested;
  else if (space && me.schools.some((s) => s.space_id === space))
    $('school').value = me.schools.find((s) => s.space_id === space).school_id;
  if (me.schools.length) await load();
  else status('加入学校后可查看当前服务。');
} catch (e) {
  status(e.message, true);
  if (e.status === 401) $('login').hidden = false;
}
