// Session content stays on the server; no conversation or credential is kept in localStorage.
export function attachReceptionSessions({ api, bubble, setContext, cancel }) {
  const $ = (id) => document.getElementById(id);
  let space = null,
    epoch = 0,
    sessions = [],
    selected = null;
  const path = () => '/api/spaces/' + encodeURIComponent(space) + '/reception-sessions';
  async function write(suffix, data) {
    return api(path() + suffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...data }),
    });
  }
  async function refresh({ restore = false } = {}) {
    const at = epoch,
      data = await api(path());
    if (at !== epoch) return;
    sessions = data.sessions;
    if (!sessions.some((s) => s.contextId === selected))
      selected = restore ? sessions[0]?.contextId : null;
    $('reception-session').replaceChildren(
      new Option('新会话（发送时创建）', ''),
      ...sessions.map(
        (s) =>
          new Option(
            new Date(s.createdAt).toLocaleString() + ' · ' + s.turnCount + ' 轮',
            s.contextId,
          ),
      ),
    );
    $('reception-session').value = selected || '';
    setContext(space, selected);
    $('reception-retention').textContent =
      '新会话默认保留 ' +
      data.policy.retentionDays +
      ' 天。当前会话' +
      (selected
        ? '到期时间：' +
          new Date(sessions.find((s) => s.contextId === selected).expiresAt).toLocaleString()
        : '发送后建立') +
      '。导出后请自行保管。';
    $('reception-export').disabled = !selected;
    $('reception-delete').disabled = !selected;
    return at;
  }
  async function showHistory() {
    cancel();
    const at = epoch,
      id = selected;
    $('conversation').replaceChildren();
    if (!id) {
      bubble('新会话已就绪。');
      return;
    }
    const data = await api(path() + '/' + encodeURIComponent(id) + '/export');
    if (at !== epoch || id !== selected) return;
    for (const t of data.turns) {
      bubble(t.question, 'user');
      if (t.answer) bubble(t.answer);
    }
    if (!data.turns.length) bubble('当前会话还没有消息。');
  }
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      bubble(e.message, 'error');
    }
  };
  $('reception-session').onchange = run(async () => {
    selected = $('reception-session').value || null;
    setContext(space, selected);
    await refresh();
    await showHistory();
  });
  $('reception-new').onclick = run(async () => {
    selected = null;
    setContext(space, null);
    await refresh();
    await showHistory();
  });
  $('reception-export').onclick = run(async () => {
    if (!selected) return;
    const data = await api(path() + '/' + encodeURIComponent(selected) + '/export');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reception-session-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('reception-delete').onclick = run(async () => {
    const s = sessions.find((s) => s.contextId === selected);
    if (!s || !confirm('删除此会话及正文？删除后不能恢复，已有备份按学校备份保留政策处理。'))
      return;
    cancel();
    await write('/' + encodeURIComponent(s.contextId) + '/delete', {
      expectedRevision: s.revision,
    });
    selected = null;
    await refresh();
    await showHistory();
  });
  return {
    async load(id) {
      space = id;
      epoch++;
      selected = null;
      try {
        await refresh({ restore: true });
        await showHistory();
      } catch (e) {
        bubble('会话列表暂不可用：' + e.message, 'error');
      }
    },
    async answered(contextId) {
      selected = contextId;
      await refresh();
    },
  };
}
