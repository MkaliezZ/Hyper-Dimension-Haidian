import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { attachSceneTools } from './scene-tools.js';
import { attachReceptionSessions } from './reception-sessions.js';
const $ = (id) => document.getElementById(id),
  canvas = $('world'),
  view = canvas.parentElement,
  scene = new THREE.Scene();
scene.background = new THREE.Color('#e6eadf');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.setClearColor('#e6eadf');
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.OrthographicCamera(-30, 30, 25, -25, 0.1, 400),
  controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minZoom = 0.5;
controls.maxZoom = 4;
controls.maxPolarAngle = Math.PI * 0.46;
controls.minPolarAngle = 0.18;
controls.enablePan = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x9ba891, 2.6));
const sun = new THREE.DirectionalLight(0xfff6df, 3);
sun.position.set(-25, 60, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.camera.far = 160;
sun.shadow.normalBias = 0.04;
scene.add(sun);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.MeshStandardMaterial({ color: '#dce4d3', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -4;
ground.receiveShadow = true;
scene.add(ground);
const avatar = new THREE.Group(),
  body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 0.48, 5, 8),
    new THREE.MeshStandardMaterial({ color: '#32675b', roughness: 0.8 }),
  ),
  head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#d4ae80' }),
  );
body.position.y = 0.55;
head.position.y = 1.13;
avatar.add(body, head);
const halo = new THREE.Mesh(
  new THREE.RingGeometry(0.34, 0.44, 30),
  new THREE.MeshBasicMaterial({ color: '#e0a443', side: THREE.DoubleSide }),
);
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.025;
avatar.add(halo);
scene.add(avatar);
const ray = new THREE.Raycaster(),
  mouse = new THREE.Vector2(),
  floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  hit = new THREE.Vector3(),
  routeGroup = new THREE.Group();
scene.add(routeGroup);
let catalog,
  pack,
  model,
  levelId,
  selected = null,
  movement = null,
  currentPosition = null,
  labelNodes = [],
  showLabels = true,
  loadingSequence = 0,
  chatController = null;
const chatContexts = new Map();
let receptionSessions;
let accountAvatar,
  accountMixer,
  accountWalk,
  accountIdle,
  accountWave,
  accountVrm,
  poseUntil = 0,
  activePose = null,
  avatarLoadSequence = 0,
  frameAt = performance.now();
async function loadAccountAvatar(spaceId) {
  if (catalog.platform !== 'm0') return;
  const seq = ++avatarLoadSequence;
  const response = await fetch('/m0/me');
  if (!response.ok) return;
  const me = await response.json(),
    school = me.schools.find((s) => s.space_id === spaceId);
  if (!school || seq !== avatarLoadSequence || pack?.spaceId !== spaceId) return;
  if (me.extensions?.includes('campus')) {
    pack.communitySchool = school.school_id;
    if (selected) updateRoomCommunity(selected.room);
  }
  let path =
    (me.extensions?.includes('m2') ? '/m2' : '/m0') + '/schools/' + school.school_id + '/avatar';
  let saved = await (await fetch(path)).json();
  if (saved.migrationRequired) {
    path = '/m0/schools/' + school.school_id + '/avatar';
    saved = await (await fetch(path)).json();
  }
  const gltf = await new GLTFLoader()
    .register((p) => new VRMLoaderPlugin(p))
    .loadAsync(path + '/model.glb?hash=' + saved.modelHash);
  if (seq !== avatarLoadSequence || pack?.spaceId !== spaceId) return;
  if (accountAvatar) {
    avatar.remove(accountAvatar);
    accountMixer?.stopAllAction();
  }
  body.visible = false;
  head.visible = false;
  accountAvatar = gltf.scene;
  avatar.add(accountAvatar);
  accountMixer = new THREE.AnimationMixer(accountAvatar);
  accountVrm = gltf.userData.vrm;
  if (accountVrm) accountVrm.humanoid.autoUpdateHumanBones = false;
  accountWalk = accountMixer.clipAction(gltf.animations.find((a) => a.name === 'Walk'));
  const idle = gltf.animations.find((a) => a.name === 'Idle'),
    wave = gltf.animations.find((a) => a.name === 'Wave');
  accountIdle = idle ? accountMixer.clipAction(idle) : null;
  accountWave = wave ? accountMixer.clipAction(wave) : null;
  activePose = null;
  avatar.userData.modelHash = saved.modelHash;
  avatar.userData.recipe = saved.recipe;
  const link = document.getElementById('account-editor');
  link.hidden = false;
  if (me.extensions?.includes('m2')) link.href = '/m2.html?school=' + school.school_id;
}
const api = async (path, options) => {
  const r = await fetch(path, options);
  const data = await r.json();
  if (!r.ok || data.error) throw Error(data.error?.message || '请求未完成');
  return data;
};
const post = (path, value) =>
    api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }),
  base = () => '/api/spaces/' + pack.spaceId;
const setStatus = (value) => ($('status').textContent = value);
function resetView() {
  if (!pack) return;
  const s = pack.scene,
    l = s.levels.find((l) => l.id === levelId),
    span = Math.max(...s.size) * 0.84,
    y = l.elevation;
  camera.left = -span;
  camera.right = span;
  camera.position.set(s.size[0] / 2 + 48, y + 48, s.size[1] / 2 + 55);
  controls.target.set(s.size[0] / 2, y, s.size[1] / 2);
  camera.zoom = 1;
  resize();
  controls.update();
}
function resize() {
  const w = view.clientWidth,
    h = view.clientHeight;
  renderer.setSize(w, h, false);
  const span = (camera.right - camera.left) / 2;
  camera.top = (span * h) / w;
  camera.bottom = -camera.top;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
function setLevel(id, { reset = false } = {}) {
  levelId = id;
  if (model)
    for (const group of model.children)
      if (group.userData.kind === 'level') group.visible = group.userData.levelId === id;
  const l = pack.scene.levels.find((l) => l.id === id);
  floorPlane.constant = -l.elevation;
  $('floors')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.level === id));
  $('rooms').replaceChildren();
  $('labels').replaceChildren();
  labelNodes = [];
  for (const room of l.rooms || []) {
    if (room.access !== 'public') continue;
    const b = document.createElement('button');
    b.textContent = room.name + ' ↗';
    b.dataset.entity = room.entityId;
    b.onclick = () => selectRoom(room);
    $('rooms').append(b);
    const label = document.createElement('div');
    label.className = 'room-label';
    label.textContent = room.name;
    $('labels').append(label);
    labelNodes.push({
      label,
      point: new THREE.Vector3(
        room.rect[0] + room.rect[2] / 2,
        l.elevation + 0.15,
        room.rect[1] + room.rect[3] * 0.65,
      ),
    });
  }
  $('room-count').textContent = labelNodes.length + ' 个';
  $('scene-name').textContent = l.name || id;
  if (reset) resetView();
}
function selectRoom(room) {
  selected = { room, levelId };
  $('welcome').classList.add('hidden');
  $('selection').classList.remove('hidden');
  $('room-name').textContent = room.name;
  $('room-description').textContent =
    room.description || '这个空间可添加公开信息、图片与项目展项。';
  updateRoomCommunity(room);
  $('exhibits').replaceChildren();
  for (const e of pack.exhibits.filter((e) => e.entityId === room.entityId)) {
    const item = document.createElement('article'),
      title = document.createElement('b'),
      body = document.createElement('p');
    title.textContent = e.title;
    body.textContent = e.body;
    item.append(title, body);
    for (const id of e.assetIds) {
      const asset = pack.assets.find((a) => a.id === id);
      if (!asset) continue;
      const img = document.createElement('img');
      img.src = asset.url;
      img.alt = e.title;
      item.append(img);
    }
    $('exhibits').append(item);
  }
}
function updateRoomCommunity(room) {
  const network = $('room-network');
  network.hidden = !pack.communitySchool;
  if (pack.communitySchool)
    network.href =
      '/network.html?' +
      new URLSearchParams({
        school: pack.communitySchool,
        sceneId: pack.scene.sceneId,
        entityId: room.entityId,
      });
  const environment = $('room-environment');
  environment.hidden = catalog.platform !== 'm0';
  environment.href =
    '/environment.html?' +
    new URLSearchParams({
      spaceId: pack.spaceId,
      sceneId: pack.scene.sceneId,
      entityId: room.entityId,
    });
  const link = $('room-community');
  link.hidden = !pack.communitySchool;
  if (pack.communitySchool)
    link.href =
      '/community.html?' +
      new URLSearchParams({
        school: pack.communitySchool,
        sceneId: pack.scene.sceneId,
        entityId: room.entityId,
      });
}
async function loadSpace(id) {
  const seq = ++loadingSequence;
  chatController?.abort();
  $('loading').classList.remove('hidden');
  $('loading').textContent = '正在打开空间…';
  try {
    const data = await api('/api/spaces/' + id + '/scene');
    const gltf = await new GLTFLoader().loadAsync(data.modelUrl);
    const nextModel = gltf.scene;
    nextModel.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    for (const art of data.scene.artwork || []) {
      const asset = data.assets.find((a) => a.id === art.assetId),
        group = nextModel.children.find((g) => g.userData.levelId === art.levelId);
      let object;
      if (art.kind === 'model') object = (await new GLTFLoader().loadAsync(asset.url)).scene;
      else
        object = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: await new THREE.TextureLoader().loadAsync(asset.url),
            color: 0xffffff,
          }),
        );
      if (object.material?.map) object.material.map.colorSpace = THREE.SRGBColorSpace;
      object.position.fromArray(art.point);
      object.scale.fromArray(art.scale);
      object.rotation.y = art.rotationY || 0;
      object.userData = { entityId: art.entityId, kind: 'artwork' };
      group.add(object);
    }
    if (seq !== loadingSequence) {
      nextModel.traverse((o) => o.geometry?.dispose());
      return;
    }
    if (model) {
      scene.remove(model);
      model.traverse((o) => {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      });
    }
    model = nextModel;
    scene.add(model);
    pack = data;
    void receptionIdentity(data, seq);
    ground.position.y = Math.min(...data.scene.levels.map((l) => l.elevation)) - 0.5;
    $('conversation').replaceChildren();
    chatContexts.delete(id);
    bubble(
      '你好，欢迎来到' + data.name + '。可以问我空间资料和路线，也可以聊学习、创意或一般问题。',
    );
    await receptionSessions.load(id);
    if (seq !== loadingSequence) return;
    $('send').disabled = false;
    movement = null;
    routeGroup.clear();
    selected = null;
    $('selection').classList.add('hidden');
    $('welcome').classList.remove('hidden');
    $('space-name').textContent = data.name;
    $('description').textContent = catalog.spaces.find((s) => s.spaceId === id).description;
    $('floors').replaceChildren();
    for (const l of data.scene.levels) {
      const b = document.createElement('button');
      b.textContent = l.name || l.id;
      b.dataset.level = l.id;
      b.onclick = () => {
        setLevel(l.id, { reset: true });
        $('welcome').classList.add('hidden');
        $('selection').classList.add('hidden');
      };
      $('floors').append(b);
    }
    $('level-count').textContent = data.scene.levels.length + ' 层';
    $('source-notes').replaceChildren();
    for (const [key, title] of [
      ['measured', '图纸依据'],
      ['inferred', '推定与简化'],
      ['unknown', '待核实'],
    ]) {
      const heading = document.createElement('b');
      heading.textContent = title;
      const ul = document.createElement('ul');
      for (const note of data.scene.source?.[key] || []) {
        const li = document.createElement('li');
        li.textContent = note;
        ul.append(li);
      }
      $('source-notes').append(heading, ul);
    }
    currentPosition = data.position;
    await loadAccountAvatar(id);
    avatar.position.fromArray(data.position.point);
    setLevel(data.position.levelId, { reset: true });
    setStatus('空间已就绪 · 点击地面行走或选择房间');
    $('loading').classList.add('hidden');
    document.documentElement.dataset.ready = 'true';
    if (catalog.extensions?.includes('m2'))
      await attachSceneTools({
        pack: () => pack,
        selected: () => selected,
        wave: () => (poseUntil = performance.now() + 3000),
        status: setStatus,
        move: moveTo,
      });
    window.baseQA = {
      geometryHash: data.geometryHash,
      modelHash: gltf.parser.json.extras.geometryHash,
      get position() {
        return currentPosition;
      },
      get level() {
        return levelId;
      },
      get drawCalls() {
        return renderer.info.render.calls;
      },
      get avatarHash() {
        return avatar.userData.modelHash;
      },
      get avatarRecipe() {
        return avatar.userData.recipe;
      },
    };
  } catch (e) {
    if (seq !== loadingSequence) return;
    $('loading').textContent = '空间加载失败：' + e.message;
    setStatus(e.message);
  }
}
function drawRoute(move) {
  routeGroup.clear();
  const points = move.path.map((p) => new THREE.Vector3(p.point[0], p.point[1] + 0.08, p.point[2]));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: '#d99c39', transparent: true, opacity: 0.7 }),
  );
  routeGroup.add(line);
}
async function moveTo(to) {
  $('welcome').classList.add('hidden');
  $('selection').classList.add('hidden');
  try {
    setStatus('正在规划可通行路线…');
    const result = await post(base() + '/move', {
      requestId: crypto.randomUUID(),
      sceneId: pack.scene.sceneId,
      ...to,
    });
    movement = { ...result, lastLevel: result.path[0].levelId };
    drawRoute(result);
    setLevel(result.path[0].levelId);
    setStatus('沿路线前往 · ' + result.distance.toFixed(1) + ' 米');
  } catch (e) {
    setStatus(e.message);
  }
}
let down = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!pack || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const rect = canvas.getBoundingClientRect();
  mouse.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    (-(e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  ray.setFromCamera(mouse, camera);
  if (!ray.ray.intersectPlane(floorPlane, hit)) return;
  const l = pack.scene.levels.find((l) => l.id === levelId),
    room = l.rooms.find(
      (r) =>
        r.access === 'public' &&
        hit.x > r.rect[0] &&
        hit.x < r.rect[0] + r.rect[2] &&
        hit.z > r.rect[1] &&
        hit.z < r.rect[1] + r.rect[3],
    );
  if (room) selectRoom(room);
  else moveTo({ levelId, point: [hit.x, l.elevation, hit.z] });
});
$('enter-room').onclick = () =>
  selected && moveTo({ levelId: selected.levelId, entityId: selected.room.entityId });
$('close-selection').onclick = () => $('selection').classList.add('hidden');
$('reset-view').onclick = resetView;
$('toggle-labels').onclick = () => {
  showLabels = !showLabels;
  $('labels').classList.toggle('hidden', !showLabels);
};
$('return-entry').onclick = () => moveTo({ levelId: pack.spawn.levelId, point: pack.spawn.point });
$('start-tour').onclick = () =>
  moveTo({ levelId: pack.spawn.levelId, point: [3, pack.spawn.point[1], pack.scene.entry.z] });
$('space').onchange = () => loadSpace($('space').value);
function bubble(text, kind = 'agent') {
  const div = document.createElement('div');
  div.className = 'bubble ' + kind;
  div.textContent = text;
  $('conversation').append(div);
  $('conversation').scrollTop = $('conversation').scrollHeight;
}
async function receptionIdentity(data, seq) {
  const agent =
    data.reception || catalog.spaces.find((s) => s.spaceId === data.spaceId)?.agents?.[0];
  $('reception-name').textContent = agent?.name || '空间接待 Agent';
  $('reception-responsibility').textContent =
    '身份：' +
    (agent?.agentId || '当前空间接待') +
    ' · 维护职责：空间包维护者。自动代表用户执行未开放。';
  $('reception-directory').hidden = true;
  if (!catalog.platform) return;
  try {
    const me = await api('/m0/me'),
      school = me.schools.find((s) => s.space_id === data.spaceId);
    if (!school) return;
    const directory = await api('/agent-directory/schools/' + encodeURIComponent(school.school_id));
    if (seq !== loadingSequence) return;
    const card = directory.cards.find(
      (c) => c.kind === 'reception-agent' && c.agentId === agent?.agentId,
    );
    if (!card) return;
    $('reception-responsibility').textContent =
      '身份：' +
      card.agentId +
      ' · 维护职责：' +
      card.maintainer.label +
      (card.maintainer.assigned ? '' : '（待指定）') +
      '。提问和留言由用户发起；不能自动报名、预约或发奖。';
    $('reception-directory').href = '/agents.html?school=' + encodeURIComponent(school.school_id);
    $('reception-directory').hidden = false;
  } catch {
    if (seq === loadingSequence)
      $('reception-responsibility').textContent =
        '身份：' +
        (agent?.agentId || '当前空间接待') +
        ' · 暂时无法核对维护职责，请稍后查看服务目录。';
  }
}
async function ask(message) {
  chatController?.abort();
  const controller = (chatController = new AbortController()),
    space = pack.spaceId,
    skillId = $('leave-message').checked ? 'message.leave' : 'space.information';
  bubble(message, 'user');
  $('send').disabled = true;
  try {
    const response = await api('/api/spaces/' + space + '/reception', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        messageId: crypto.randomUUID(),
        skillId,
        ...(skillId === 'space.information' && chatContexts.has(space)
          ? { contextId: chatContexts.get(space) }
          : {}),
      }),
    });
    if (pack.spaceId !== space) return;
    const task = response.result.task,
      result = JSON.parse(task.artifacts?.[0]?.parts?.[0]?.text || 'null');
    if (!result) throw Error(task.status.message?.parts?.[0]?.text || '接待暂不可用，请稍后重试');
    if (skillId === 'space.information') chatContexts.set(space, task.contextId);
    bubble(result.text);
    if (result.basis === 'general') bubble('通用交流 · 不作为本空间已核实资料', 'sources');
    if (result.basis === 'unavailable') bubble('本空间的这项信息尚未提供', 'sources');
    if (result.sources?.length)
      bubble(
        '资料来源：' + result.sources.map((s) => s.title + ' / r' + s.revision).join('；'),
        'sources',
      );
    if (skillId === 'space.information') await receptionSessions.answered(task.contextId);
  } catch (e) {
    if (!controller.signal.aborted && pack.spaceId === space) bubble(e.message, 'error');
  } finally {
    if (chatController === controller) $('send').disabled = false;
  }
}
receptionSessions = attachReceptionSessions({
  api,
  bubble,
  setContext: (space, id) => (id ? chatContexts.set(space, id) : chatContexts.delete(space)),
  cancel: () => chatController?.abort(),
});
$('chat').onsubmit = (e) => {
  e.preventDefault();
  const message = $('message').value.trim();
  if (!message) return;
  $('message').value = '';
  void ask(message);
};
document
  .querySelectorAll('[data-question]')
  .forEach((b) => (b.onclick = () => void ask(b.dataset.question)));
function animate() {
  requestAnimationFrame(animate);
  const frameNow = performance.now(),
    frameDelta = Math.min((frameNow - frameAt) / 1000, 0.1);
  frameAt = frameNow;
  if (accountMixer) {
    const next =
      performance.now() < poseUntil && accountWave
        ? accountWave
        : movement
          ? accountWalk
          : accountIdle;
    if (next !== activePose) {
      activePose?.stop();
      next?.reset().play();
      activePose = next;
    }
  }
  accountMixer?.update(frameDelta);
  accountVrm?.update(frameDelta);
  if (movement) {
    let travel = Math.max(0, ((Date.now() - movement.startedAt) / 1000) * movement.speed),
      p = movement.path.at(-1),
      left = travel;
    for (let i = 1; i < movement.path.length; i++) {
      const a = movement.path[i - 1],
        b = movement.path[i],
        len = Math.hypot(...b.point.map((v, j) => v - a.point[j]));
      if (left <= len) {
        const t = len ? left / len : 1;
        p = {
          levelId: t < 0.5 ? a.levelId : b.levelId,
          point: a.point.map((v, j) => v + (b.point[j] - v) * t),
        };
        avatar.rotation.y = Math.atan2(b.point[0] - a.point[0], b.point[2] - a.point[2]);
        break;
      }
      left -= len;
    }
    avatar.position.fromArray(p.point);
    currentPosition = { ...p, moving: travel < movement.distance };
    if (p.levelId !== movement.lastLevel) {
      movement.lastLevel = p.levelId;
      setLevel(p.levelId);
    }
    if (travel >= movement.distance) {
      movement = null;
      setStatus('已到达 · 可继续探索空间');
      routeGroup.clear();
    }
  }
  if (currentPosition) {
    avatar.visible = currentPosition.levelId === levelId;
    $('position').textContent =
      currentPosition.levelId +
      ' · ' +
      currentPosition.point[0].toFixed(1) +
      ', ' +
      currentPosition.point[2].toFixed(1) +
      ' m';
  }
  controls.update();
  for (const { label, point } of labelNodes) {
    const p = point.clone().project(camera);
    label.style.left = (p.x * 0.5 + 0.5) * view.clientWidth + 'px';
    label.style.top = (-p.y * 0.5 + 0.5) * view.clientHeight + 'px';
    label.style.display = p.z > 1 ? 'none' : '';
  }
  renderer.render(scene, camera);
}
animate();
try {
  catalog = await api('/api/catalog');
  for (const p of catalog.spaces) {
    const option = document.createElement('option');
    option.value = p.spaceId;
    option.textContent = p.name;
    $('space').append(option);
  }
  $('mode').textContent =
    catalog.receptionMode === 'live-model'
      ? (catalog.receptionProvider === 'hermes' ? '本地 Hermes 接待' : '在线模型接待') +
        ' · 通用交流 / 空间资料'
      : '资料接待 · 只引用已发布内容';
  const id = new URL(location.href).searchParams.get('space');
  if (catalog.spaces.some((p) => p.spaceId === id)) $('space').value = id;
  await loadSpace($('space').value);
} catch (e) {
  $('loading').textContent = e.message;
}
