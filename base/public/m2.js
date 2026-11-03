import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
const $ = (id) => document.getElementById(id),
  node = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
const messages = {
  avatar_incompatible_parts: '这两个部件会重叠，请换一个搭配。',
  avatar_write_conflict: '存档已在另一处更新，请先恢复已保存形象。',
  inventory_write_conflict: '背包已更新，已重新读取，请再操作。',
  avatar_explicit_migration_required: '旧存档需要你确认迁移后才能启用。',
  avatar_catalog_upgrade_confirmation_required:
    '请确认升级素材库；已保存的旧版形象会保留在历史记录中。',
  avatar_catalog_transition_unsupported: '已升级存档不能直接降级到旧素材库。旧版历史仍保留。',
  request_conflict: '请求内容已变化，请刷新后重试。',
};
async function api(path, body) {
  const r = await fetch(
    path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
  if (!r.ok) {
    const d = await r.json();
    throw Error(
      messages[d.error?.code] ||
        messages[d.error?.message] ||
        d.error?.message ||
        '请求失败 ' + r.status,
    );
  }
  return r.json();
}
let me,
  school,
  catalog,
  saved,
  recipe,
  inventory,
  profile,
  sequence = 0,
  previewTimer,
  pendingSave = null;
const root = () => '/m2/schools/' + school.school_id;
const status = (text) => ($('status').textContent = text);
const run =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      status(e.message);
    }
  };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d6dfc7');
const renderer = new THREE.WebGLRenderer({ canvas: $('avatar'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const camera = new THREE.PerspectiveCamera(31, 1, 0.05, 50);
camera.position.set(2.7, 1.8, 4.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.6;
scene.add(new THREE.HemisphereLight('#fff9e9', '#60765d', 3));
const sun = new THREE.DirectionalLight('#fff3db', 3);
sun.position.set(3, 6, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight('#b5d4ff', 2);
rim.position.set(-3, 2, -2);
scene.add(rim);
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(0.65, 0.7, 0.08, 64),
  new THREE.MeshStandardMaterial({ color: '#a9b89a', roughness: 0.9 }),
);
pedestal.position.y = -0.05;
scene.add(pedestal);
const loader = new GLTFLoader().register((parser) => new VRMLoaderPlugin(parser));
let current,
  mixer,
  vrm,
  pose = 'Idle',
  last = performance.now();
function play(name) {
  pose = name;
  if (!mixer) return;
  mixer.stopAllAction();
  const clip = current.animations.find((c) => c.name === name);
  if (clip) mixer.clipAction(clip).reset().play();
}
function release() {
  if (!current) return;
  scene.remove(current.scene);
  mixer.stopAllAction();
  current.scene.traverse((o) => {
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
}
async function preview() {
  const seq = ++sequence;
  try {
    const r = await fetch(root() + '/avatar/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    if (!r.ok) {
      const e = await r.json();
      if (seq === sequence) {
        $('compatibility').textContent =
          messages[e.error?.code] || messages[e.error?.message] || e.error?.message;
        $('save').disabled = true;
      }
      return;
    }
    const gltf = await loader.parseAsync(await r.arrayBuffer(), location.origin + '/');
    if (seq !== sequence) {
      gltf.scene.traverse((o) => o.geometry?.dispose());
      return;
    }
    release();
    current = gltf;
    mixer = new THREE.AnimationMixer(gltf.scene);
    vrm = gltf.userData.vrm;
    if (vrm) vrm.humanoid.autoUpdateHumanBones = false;
    scene.add(gltf.scene);
    play(pose);
    $('compatibility').textContent = '';
    $('save').disabled = needsCatalogUpgrade() && !$('confirm-catalog-upgrade')?.checked;
    const ex = gltf.parser.json.extras;
    $('model-stats').textContent =
      ex.triangles.toLocaleString() + ' 三角面 / ' + ex.drawCalls + ' 批次';
    window.m2QA = {
      get recipe() {
        return recipe;
      },
      get saved() {
        return saved;
      },
      get pose() {
        return pose;
      },
      get vrm() {
        return Boolean(vrm);
      },
      get drawCalls() {
        return renderer.info.render.calls;
      },
      get modelReady() {
        return Boolean(current);
      },
    };
  } catch (e) {
    if (seq === sequence) {
      $('compatibility').textContent = e.message;
      $('save').disabled = true;
    }
  }
}
function changed() {
  pendingSave = null;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void preview(), 180);
}
function option(value, label) {
  const o = node('option', label);
  o.value = value;
  return o;
}
function selectField(container, key, label, choices, value, onchange) {
  const l = node('label', label),
    s = node('select');
  s.id = 'part-' + key;
  for (const [id, text] of choices) s.append(option(id, text));
  s.value = value;
  s.onchange = () => {
    onchange(s.value);
    changed();
  };
  l.append(s);
  container.append(l);
}
function renderRecipe() {
  const parts = $('parts');
  parts.replaceChildren();
  for (const [key, label] of Object.entries({
    body: '体型',
    hair: '发型',
    top: '上装',
    bottom: '下装',
    shoes: '鞋子',
    glasses: '眼镜',
    accessory: '配饰',
  }))
    selectField(
      parts,
      key,
      label,
      catalog.parts.filter((p) => p.slot === key).map((p) => [p.id, p.label]),
      recipe.parts[key],
      (v) => (recipe.parts[key] = v),
    );
  selectField(
    parts,
    'height',
    '身高',
    [
      ['short', '较矮'],
      ['standard', '标准'],
      ['tall', '较高'],
    ],
    recipe.height,
    (v) => (recipe.height = v),
  );
  selectField(
    parts,
    'presentation',
    '性别表现 / 轮廓',
    [
      ['neutral', '中性'],
      ['soft', '柔和'],
      ['angular', '棱角'],
    ],
    recipe.presentation,
    (v) => (recipe.presentation = v),
  );
  selectField(
    parts,
    'skin',
    '肤色',
    Object.keys(catalog.skins).map((k, i) => [
      k,
      ['瓷白', '浅肤', '暖肤', '小麦', '深肤', '乌木'][i],
    ]),
    recipe.skin,
    (v) => (recipe.skin = v),
  );
  $('colors').replaceChildren();
  for (const [key, label] of Object.entries({
    hair: '发色',
    top: '上装颜色',
    bottom: '下装颜色',
    shoes: '鞋子颜色',
  })) {
    const l = node('label', label),
      i = node('input');
    i.type = 'color';
    i.id = 'color-' + key;
    i.value = recipe.colors[key];
    i.oninput = () => {
      recipe.colors[key] = i.value;
      changed();
    };
    l.append(i);
    $('colors').append(l);
  }
}
const needsCatalogUpgrade = () =>
  Boolean(saved && recipe && saved.recipe.catalogVersion !== recipe.catalogVersion);
function renderCatalogControls() {
  if (!$('catalog-controls')) {
    const panel = node('div'),
      label = node('label', '人物素材库版本'),
      select = node('select'),
      confirmation = node('label'),
      check = node('input');
    panel.id = 'catalog-controls';
    select.id = 'catalog-version';
    select.setAttribute('aria-label', '人物素材库版本');
    check.type = 'checkbox';
    check.id = 'confirm-catalog-upgrade';
    check.style.width = 'auto';
    confirmation.id = 'catalog-upgrade-confirmation';
    confirmation.className = 'notice';
    confirmation.append(
      check,
      document.createTextNode(' 我确认升级到扩充素材库。保存后启用，旧配方和旧模型摘要继续保留。'),
    );
    label.append(select);
    panel.append(label, confirmation);
    $('presets').before(panel);
    check.onchange = () => {
      pendingSave = null;
      $('save').disabled =
        Boolean($('compatibility').textContent) || (needsCatalogUpgrade() && !check.checked);
    };
    select.onchange = run(async () => {
      select.disabled = true;
      $('save').disabled = true;
      try {
        const next = await api(
          root() + '/avatar/catalog?version=' + encodeURIComponent(select.value),
        );
        recipe =
          select.value === saved.recipe.catalogVersion
            ? structuredClone(saved.recipe)
            : {
                ...structuredClone(recipe),
                catalogVersion: next.version,
                skeletonVersion: next.skeletonVersion,
                generatorVersion: next.generatorVersion,
              };
        catalog = next;
        pendingSave = null;
        check.checked = false;
        renderCatalogControls();
        renderCatalogPresets();
        renderRecipe();
        await preview();
        status(
          needsCatalogUpgrade()
            ? '正在预览扩充素材；勾选确认并保存后才会改变存档。'
            : '已回到当前已保存素材库。',
        );
      } finally {
        select.disabled = false;
      }
    });
  }
  const select = $('catalog-version');
  select.replaceChildren();
  for (const item of saved.availableCatalogs || [
    { version: saved.recipe.catalogVersion, label: saved.recipe.catalogVersion },
  ]) {
    if (
      (saved.recipe.catalogVersion === 'campus-original-2' &&
        item.version === 'campus-original-1') ||
      (saved.recipe.catalogVersion === 'campus-rewards-3' && item.version !== 'campus-rewards-3') ||
      (saved.recipe.catalogVersion === 'campus-original-1' && item.version === 'campus-rewards-3')
    )
      continue;
    select.append(option(item.version, item.label));
  }
  select.value = recipe.catalogVersion;
  $('catalog-upgrade-confirmation').hidden = !needsCatalogUpgrade();
  $('save').textContent = needsCatalogUpgrade()
    ? '确认升级并保存形象'
    : saved.migrationRequired
      ? '迁移并保存'
      : '保存我的形象';
}
function renderCatalogPresets() {
  $('library-note').textContent =
    catalog.parts.length +
    ' 个原创 MIT 部件 · ' +
    catalog.version +
    ' · ' +
    catalog.skeletonVersion +
    ' · 站立 / 行走 / 挥手。部件、配方与模型 SHA-256 由服务端检查。';
  $('presets').replaceChildren();
  for (const p of catalog.presets || []) {
    const b = node('button', p.label || p.name || p.id);
    b.onclick = run(async () => {
      recipe = structuredClone(p.recipe);
      pendingSave = null;
      renderRecipe();
      await preview();
      status('已切换预设，保存后生效。');
    });
    $('presets').append(b);
  }
}
async function refreshAvatar() {
  saved = await api(root() + '/avatar');
  catalog = await api(
    root() + '/avatar/catalog?version=' + encodeURIComponent(saved.recipe.catalogVersion),
  );
  recipe = structuredClone(saved.recipe);
  pendingSave = null;
  renderCatalogControls();
  renderCatalogPresets();
  $('confirm-catalog-upgrade').checked = false;
  renderRecipe();
  $('migration').hidden = !saved.migrationRequired;
  $('save').textContent = saved.migrationRequired ? '迁移并保存' : '保存我的形象';
  $('saved').textContent = saved.version
    ? '已保存版本 ' + saved.version + ' · ' + saved.modelHash.slice(0, 16)
    : '尚未启用新人物；保存后可在空间中使用。';
  await preview();
}
async function refreshBag() {
  inventory = await api(root() + '/inventory');
  $('starter').hidden = inventory.starterClaimed;
  $('inventory').replaceChildren();
  for (const item of inventory.catalog) {
    const record = inventory.items.find((i) => i.item_id === item.id),
      card = node('article');
    card.className = 'item';
    card.dataset.item = item.id;
    card.dataset.equipped = inventory.equippedItem === item.id;
    const count = node('span', '× ' + (record?.quantity || 0));
    count.className = 'count';
    card.append(count, node('h3', item.name), node('p', item.description));
    if (item.slot === 'tool' && record?.quantity) {
      const b = node('button', inventory.equippedItem === item.id ? '收起' : '装备');
      b.onclick = run(async () => {
        await api(root() + '/inventory/equip', {
          requestId: crypto.randomUUID(),
          expectedRevision: inventory.revision,
          itemId: item.id,
          equipped: inventory.equippedItem !== item.id,
        });
        await refreshBag();
        status('背包装备已保存。');
      });
      card.append(b);
    }
    $('inventory').append(card);
  }
  const events = await api(root() + '/inventory/events');
  $('ledger').replaceChildren(
    ...events.events.map((e) =>
      node(
        'li',
        new Date(e.created_at).toLocaleString() +
          ' · ' +
          e.action +
          ' · ' +
          e.item_id +
          ' ' +
          (e.delta > 0 ? '+' : '') +
          e.delta,
      ),
    ),
  );
}
async function refreshCollections() {
  const result = await api(root() + '/collections');
  $('collections').replaceChildren();
  if (!result.items.length)
    $('collections').append(node('p', '还没有收藏。带上背包，进入空间探索吧。'));
  for (const item of result.items) {
    const c = node('article');
    c.className = 'collection';
    c.dataset.collection = item.collection_id;
    c.append(
      node(
        'h3',
        { stamp: '到访印章', bookmark: '地图收藏', postcard: '地点明信片', note: '私人记忆卡' }[
          item.kind
        ] +
          ' · ' +
          item.payload.roomName,
      ),
      node('p', item.payload.text || item.payload.caption || item.payload.spaceName),
    );
    const a = node('a', '前往地点 →');
    a.href =
      '/?' + new URLSearchParams({ space: school.space_id, place: item.payload.entityId || '' });
    c.append(a);
    if (item.kind === 'postcard') {
      const a = node('a', '下载明信片');
      a.href = root() + '/collections/' + item.collection_id + '.svg';
      a.download = 'campus-postcard.svg';
      c.append(a);
    }
    if (item.kind === 'note') {
      const a = node('a', '带到论坛编辑器');
      a.href =
        '/m1.html?' +
        new URLSearchParams({ school: school.school_id, m2draft: item.collection_id });
      c.append(a);
    }
    $('collections').append(c);
  }
}
async function refreshProfile() {
  profile = await api(root() + '/profile');
  $('profile-fields').replaceChildren();
  for (const [key, title] of Object.entries({
    bio: '自我介绍',
    department: '院系 / 组织',
    year: '年级 / 届别',
    interests: '兴趣（逗号分隔，最多 8 项）',
  })) {
    const l = node('label', title),
      input = node(key === 'bio' ? 'textarea' : 'input');
    input.id = 'profile-' + key;
    input.value =
      key === 'interests' ? (profile.fields[key] || []).join('，') : profile.fields[key] || '';
    if (key === 'bio') {
      input.rows = 3;
      input.maxLength = 500;
    }
    l.append(input);
    const v = node('select');
    v.id = 'visibility-' + key;
    v.append(option('private', '仅自己'), option('school', '本校成员'));
    v.value = profile.visibility[key] || 'private';
    l.append(v);
    $('profile-fields').append(l);
  }
}
async function loadSchool() {
  school = me.schools.find((s) => s.school_id === $('school').value);
  if (!school) return;
  $('enter-space').href = $('agent-space').href = '/?space=' + encodeURIComponent(school.space_id);
  await Promise.all([refreshAvatar(), refreshBag(), refreshCollections(), refreshProfile()]);
  status('已读取 ' + (school.name || school.school_id) + ' 的形象、背包和私人收藏。');
}
$('save').onclick = run(async () => {
  if (needsCatalogUpgrade() && !$('confirm-catalog-upgrade').checked)
    throw Error(messages.avatar_catalog_upgrade_confirmation_required);
  pendingSave ||= {
    requestId: crypto.randomUUID(),
    expectedVersion: saved.version,
    catalogHash: catalog.catalogHash,
    recipe: structuredClone(recipe),
    ...(saved.migrationRequired ? { legacyVersion: saved.legacyVersion } : {}),
    ...(needsCatalogUpgrade()
      ? {
          upgradeFrom: {
            catalogVersion: saved.recipe.catalogVersion,
            catalogHash: saved.catalogHash,
            modelHash: saved.modelHash,
          },
        }
      : {}),
  };
  const r = await api(root() + '/avatar', pendingSave);
  saved = r;
  pendingSave = null;
  renderCatalogControls();
  $('confirm-catalog-upgrade').checked = false;
  $('migration').hidden = true;
  $('save').textContent = '保存我的形象';
  $('saved').textContent = '已保存版本 ' + r.version + ' · ' + r.modelHash.slice(0, 16);
  status('人物已保存。再次登录或换浏览器会恢复同一形象。');
});
$('reload').onclick = run(async () => {
  await refreshAvatar();
  status('已恢复服务端保存的形象。');
});
$('starter').onclick = run(async () => {
  await api(root() + '/inventory/starter', {
    requestId: crypto.randomUUID(),
    expectedRevision: inventory.revision,
  });
  await refreshBag();
  status('欢迎背包已领取。每个学校账号仅发放一次。');
});
$('profile').onsubmit = run(async (e) => {
  e.preventDefault();
  const fields = {},
    visibility = {};
  for (const key of ['bio', 'department', 'year', 'interests']) {
    fields[key] =
      key === 'interests'
        ? $('profile-' + key)
            .value.split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : $('profile-' + key).value;
    visibility[key] = $('visibility-' + key).value;
  }
  await api(root() + '/profile', {
    requestId: crypto.randomUUID(),
    expectedVersion: profile.version,
    fields,
    visibility,
  });
  await refreshProfile();
  status('名片与可见范围已保存。');
});
$('school').onchange = run(loadSchool);
document.querySelectorAll('[data-pose]').forEach((b) => (b.onclick = () => play(b.dataset.pose)));
$('reset-camera').onclick = () => {
  camera.position.set(2.7, 1.8, 4.5);
  controls.target.set(0, 1, 0);
};
new ResizeObserver(() => {
  const c = $('avatar');
  renderer.setSize(c.clientWidth, c.clientHeight, false);
  camera.aspect = c.clientWidth / c.clientHeight;
  camera.updateProjectionMatrix();
}).observe($('avatar'));
renderer.setAnimationLoop(() => {
  const now = performance.now(),
    delta = Math.min((now - last) / 1000, 0.1);
  last = now;
  mixer?.update(delta);
  vrm?.update(delta);
  controls.update();
  renderer.render(scene, camera);
});
await run(async () => {
  const r = await fetch('/m0/me');
  if (r.status === 401) {
    $('login').hidden = false;
    status('登录后开启校园形象与背包。');
    return;
  }
  if (!r.ok) throw Error('账号服务暂不可用');
  me = await r.json();
  if (!me.extensions?.includes('m2')) throw Error('当前服务器尚未启用 M2。');
  for (const s of me.schools) $('school').append(option(s.school_id, s.name || s.school_id));
  if (!me.schools.length) throw Error('需要已确认的学校成员身份。');
  const chosen = new URLSearchParams(location.search).get('school');
  if (me.schools.some((s) => s.school_id === chosen)) $('school').value = chosen;
  $('studio').hidden = false;
  await loadSchool();
})();
