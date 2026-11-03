export async function attachSceneTools({ pack, selected, wave, status, move }) {
  const meResponse = await fetch('/m0/me');
  if (!meResponse.ok) return;
  const me = await meResponse.json();
  if (!me.extensions?.includes('m2')) return;
  const school = me.schools.find((s) => s.space_id === pack().spaceId);
  if (!school) return;
  const root = '/m2/schools/' + school.school_id,
    container = document.getElementById('bag-tools');
  container.hidden = false;
  container.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = '校园背包';
  const info = document.createElement('p');
  info.textContent = '先选择地点并沿路线抵达，再使用道具。';
  const tools = document.createElement('select');
  tools.id = 'equipped-tool';
  tools.setAttribute('aria-label', '使用道具');
  const text = document.createElement('textarea');
  text.id = 'tool-text';
  text.placeholder = '明信片题记（70字以内）或私人记忆（8–500字）';
  text.maxLength = 500;
  text.rows = 2;
  text.setAttribute('aria-label', '道具文字');
  const button = document.createElement('button');
  button.id = 'use-tool';
  button.textContent = '使用道具';
  const link = document.createElement('a');
  link.href = '/m2.html?school=' + encodeURIComponent(school.school_id);
  link.textContent = '编辑人物 / 查看收藏 ↗';
  const message = document.createElement('p');
  message.id = 'tool-result';
  message.setAttribute('role', 'status');
  container.append(heading, info, tools, text, button, message, link);
  let inventory,
    pending = null;
  async function api(path, body) {
    const r = await fetch(
      root + path,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
    const d = await r.json();
    if (!r.ok) throw Object.assign(Error(d.error?.message || '道具暂不可用'), { status: r.status });
    return d;
  }
  async function refresh() {
    inventory = await api('/inventory');
    const value = tools.value;
    tools.replaceChildren();
    for (const i of inventory.catalog.filter((i) => i.actions.length)) {
      const own = inventory.items.find((p) => p.item_id === i.id);
      if (!own?.quantity) continue;
      const o = document.createElement('option');
      o.value = i.id;
      o.textContent = i.name + ' × ' + own.quantity;
      tools.append(o);
    }
    if ([...tools.options].some((o) => o.value === value)) tools.value = value;
    button.disabled = !tools.options.length;
    if (!inventory.starterClaimed)
      message.textContent = '尚未领取欢迎背包，请先前往“编辑人物 / 查看收藏”。';
  }
  tools.onchange = () => (pending = null);
  text.oninput = () => (pending = null);
  button.onclick = async () => {
    button.disabled = true;
    try {
      const room = selected(),
        item = inventory.catalog.find((i) => i.id === tools.value);
      if (!item) throw Error('请先领取背包');
      if (item.actions[0] !== 'wave' && !room) throw Error('请先选择公开地点');
      const target = {
        sceneId: pack().scene.sceneId,
        ...(room ? { entityId: room.room.entityId } : {}),
      };
      if (!pending) {
        if (item.slot === 'tool' && inventory.equippedItem !== item.id)
          inventory = await api('/inventory/equip', {
            requestId: crypto.randomUUID(),
            expectedRevision: inventory.revision,
            itemId: item.id,
            equipped: true,
          });
        pending = {
          requestId: crypto.randomUUID(),
          expectedRevision: inventory.revision,
          itemId: item.id,
          action: item.actions[0],
          ...target,
          ...(item.id === 'postcard-camera'
            ? { caption: text.value }
            : item.id === 'note-card'
              ? { text: text.value }
              : {}),
        };
      }
      const r = await api('/inventory/use', pending);
      pending = null;
      await refresh();
      if (r.kind === 'wave') wave();
      message.textContent = r.alreadyCollected
        ? '这个地点已经收藏。'
        : {
            stamp: '已收集到访印章。',
            bookmark: '已收藏地点，可在人物页查看。',
            postcard: '明信片已保存，使用了一张纸。',
            note: '私人记忆已保存，尚未公开。',
            wave: '挥手应援 · 仅自己的画面可见。',
          }[r.kind];
      status(message.textContent);
    } catch (e) {
      if (e.status && e.status < 500) pending = null;
      message.textContent =
        {
          tool_arrival_required: '请先点击“前往这个房间”，到达后再使用。',
          inventory_quantity_conflict: '道具材料不足。',
          tool_rate_limited: '挥手后请稍等三秒。',
          inventory_write_conflict: '背包已在另一处更新，请再试一次。',
          postcard_caption_invalid: '明信片题记请控制在 70 字以内。',
          note_text_invalid: '私人记忆需要 8–500 字。',
        }[e.message] || e.message;
      if (e.message === 'inventory_write_conflict') await refresh();
    } finally {
      button.disabled = false;
    }
  };
  await refresh();
  const place = new URLSearchParams(location.search).get('place');
  if (place) {
    const l = pack().scene.levels.find((l) =>
      l.rooms.some((r) => r.access === 'public' && r.entityId === place),
    );
    if (l) await move({ levelId: l.id, entityId: place });
  }
}
