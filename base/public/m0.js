import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const $ = (id) => document.getElementById(id),
  request = async (path, body, method = body ? 'POST' : 'GET') => {
    const r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) {
      let d = await r.json();
      throw Error(d.error?.message || '操作未完成');
    }
    return r.json();
  };
const labels = {
  body: '身形',
  hair: '发型',
  top: '上装',
  bottom: '下装',
  shoes: '鞋子',
  glasses: '眼镜',
  accessory: '配饰',
  skin: '肤色',
  palette: '配色',
};
const names = {
  standard: '舒展',
  compact: '小巧',
  short: '清爽短发',
  bob: '齐耳短发',
  jacket: '校园外套',
  shirt: '简洁上衣',
  trousers: '长裤',
  skirt: '短裙',
  sneakers: '休闲鞋',
  boots: '短靴',
  none: '不佩戴',
  round: '深色眼镜',
  satchel: '斜挎包',
  warm: '暖棕',
  deep: '深棕',
  light: '浅暖',
  teal: '青绿',
  indigo: '靛蓝',
  ochre: '赭黄',
};
let school,
  me,
  recipe,
  version = 0,
  previewSequence = 0,
  model,
  mixer,
  selectedAction;
const path = () => '/m0/schools/' + school;
const canvas = $('avatar'),
  scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100),
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
camera.position.set(2.7, 1.8, 4.3);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.85, 0);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * 0.48;
controls.enablePan = false;
scene.add(new THREE.HemisphereLight(0xffffff, 0x93a190, 3));
const light = new THREE.DirectionalLight(0xffeed8, 3);
light.position.set(3, 6, 4);
scene.add(light);
const ground = new THREE.Mesh(
  new THREE.CylinderGeometry(0.72, 0.83, 0.055, 60),
  new THREE.MeshStandardMaterial({ color: 0xc2d2be, roughness: 1 }),
);
ground.position.y = -0.04;
scene.add(ground);
let last = performance.now();
function animate(t) {
  requestAnimationFrame(animate);
  const rect = canvas.parentElement.getBoundingClientRect();
  if (rect.width) {
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  mixer?.update(Math.min((t - last) / 1000, 0.1));
  last = t;
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
function dispose(group) {
  group?.traverse((o) => {
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
}
async function preview() {
  const seq = ++previewSequence,
    r = await fetch(path() + '/avatar/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
  if (!r.ok) throw Error('人物组合暂时无法预览');
  const buffer = await r.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  if (seq !== previewSequence) {
    dispose(gltf.scene);
    return;
  }
  if (model) {
    scene.remove(model);
    mixer?.stopAllAction();
    dispose(model);
  }
  model = gltf.scene;
  scene.add(model);
  mixer = new THREE.AnimationMixer(model);
  selectedAction = mixer.clipAction(gltf.animations.find((a) => a.name === 'Wave'));
  selectedAction.play();
  window.m0QA = {
    recipe: () => structuredClone(recipe),
    renderedRecipe: () => structuredClone(model.getObjectByName('AvatarRoot').userData.recipe),
    nodes: () => model.children[0]?.children.length,
    drawCalls: () => renderer.info.render.calls,
  };
}
async function refresh() {
  const [list, ranking] = await Promise.all([
    request(path() + '/forum'),
    request(path() + '/ranking'),
  ]);
  $('items').replaceChildren();
  const role = me.schools.find((s) => s.school_id === school).role;
  for (const item of list.items.slice().reverse().slice(0, 8)) {
    const card = document.createElement('article');
    card.className = 'memory-card';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const desc = document.createElement('p');
    desc.textContent =
      ({ pending: '等待审核', published: '已采纳', withdrawn: '已撤回' }[item.status] ||
        item.status) +
      ' · 版本 ' +
      item.revision;
    card.append(title, desc);
    if (['moderator', 'owner'].includes(role) && ['pending', 'published'].includes(item.status)) {
      const b = document.createElement('button');
      b.textContent = item.status === 'pending' ? '采纳并发布' : '撤回内容';
      b.onclick = async () => {
        try {
          b.disabled = true;
          await request(path() + '/forum', {
            action: item.status === 'pending' ? 'approve' : 'withdraw',
            id: item.id,
          });
          await refresh();
        } catch (e) {
          $('status').textContent = e.message;
        } finally {
          b.disabled = false;
        }
      };
      card.append(b);
    }
    $('items').append(card);
  }
  if (!list.items.length)
    $('items').textContent = '这里会留下本校已发布的记忆，以及你自己的待审记录。';
  $('ranking').replaceChildren();
  ranking.rows.forEach((row, i) => {
    const li = document.createElement('li'),
      name = document.createElement('span'),
      score = document.createElement('b');
    name.textContent =
      String(i + 1).padStart(2, '0') +
      '　' +
      (row.user_id === me.userId ? '我的贡献' : '校园成员 ' + row.user_id.slice(0, 6));
    score.textContent = row.score;
    li.append(name, score);
    $('ranking').append(li);
  });
  if (!ranking.rows.length) $('ranking').textContent = '第一段校园记忆，等你留下。';
}
async function load() {
  school = $('school').value;
  const a = await request(path() + '/avatar'),
    { catalog } = await request(path() + '/avatar/catalog');
  recipe = a.recipe;
  version = a.version;
  $('version').textContent = '存档 v' + version;
  $('parts').replaceChildren();
  for (const key of Object.keys(labels)) {
    const label = document.createElement('label');
    label.textContent = labels[key];
    const select = document.createElement('select');
    select.name = key;
    for (const value of catalog[key]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = names[value] || value;
      select.append(opt);
    }
    select.value = recipe[key];
    select.onchange = () => {
      recipe[key] = select.value;
      preview().catch((e) => ($('status').textContent = e.message));
      $('save-status').textContent = '有未保存的修改';
    };
    label.append(select);
    $('parts').append(label);
  }
  $('enter').href = '/?space=' + me.schools.find((s) => s.school_id === school).space_id;
  $('forum-link').href = path() + '/forum-login';
  await preview();
  await refresh();
  document.documentElement.dataset.m0ready = 'true';
}
$('editor').onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const saved = await request(
      path() + '/avatar',
      { requestId: crypto.randomUUID(), expectedVersion: version, recipe },
      'PUT',
    );
    version = saved.version;
    $('version').textContent = '存档 v' + version;
    $('save-status').textContent = '已保存到服务器。下次登录会恢复这个形象。';
    $('save-status').dataset.hash = saved.modelHash;
  } catch (e) {
    $('save-status').textContent = e.message;
  } finally {
    b.disabled = false;
  }
};
$('post').onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    await request(path() + '/forum', {
      action: 'submit',
      requestId: crypto.randomUUID(),
      title: $('title').value,
      content: $('content').value,
    });
    $('post').reset();
    await refresh();
  } catch (e) {
    $('status').textContent = e.message;
  } finally {
    b.disabled = false;
  }
};
$('logout').onclick = async () => {
  await request('/auth/logout', {});
  location.reload();
};
$('school').onchange = () => load().catch((e) => ($('status').textContent = e.message));
$('refresh').onclick = () => refresh().catch((e) => ($('status').textContent = e.message));
try {
  me = await request('/m0/me');
  $('login').hidden = true;
  $('workspace').hidden = false;
  $('logout').hidden = false;
  $('name').textContent = me.name;
  for (const s of me.schools) {
    const o = document.createElement('option');
    o.value = s.school_id;
    o.textContent = s.school_id;
    $('school').append(o);
  }
  if (me.schools.length) await load();
  else $('status').textContent = '账号已登录，等待空间维护者授予学校成员资格。';
} catch (e) {
  if (e.message !== 'login_required') $('status').textContent = e.message;
}
