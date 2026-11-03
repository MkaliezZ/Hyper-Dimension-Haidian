import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROTOCOL, BASE_VERSION } from '../src/protocol/index.mjs';
import { SCENE_FORMAT, roomPoint } from '../src/spatial/building.mjs';
const save = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};
const room = (id, name, rect, edge = 'south', offset = rect[2] / 2, kind = 'exhibit') => ({
  entityId: id,
  name,
  rect,
  access: 'public',
  door: { edge, offset, width: 1.8 },
  kind,
  description: name + '的概念展示空间。展项和材质可由学校 Agent 继续补充。',
});
export function exampleScene(id = 'north-hall', variant = 0) {
  const size = variant ? [24, 18] : [20, 16];
  return {
    format: SCENE_FORMAT,
    sceneId: id,
    name: variant ? '南岸创客中心' : '北岸学生中心',
    units: 'm',
    axes: 'Y_UP_X_EAST_Z_SOUTH',
    size,
    cellSize: 0.4,
    entry: { levelId: 'L1', z: 10 },
    levels: [
      {
        id: 'L1',
        name: '一层 · 迎新与展览',
        elevation: 0,
        height: 3.6,
        rooms: [
          room(id + '-gallery', '项目展厅', [6, 0.4, 7, 5]),
          room(id + '-club', '社团空间', [13.4, 0.4, size[0] - 13.8, 5]),
        ],
        voids: [],
      },
      {
        id: 'L2',
        name: '二层 · 共享工作室',
        elevation: 3.6,
        height: 3.6,
        rooms: [room(id + '-studio', '共享工作室', [7, 0.4, size[0] - 7.4, 5])],
        voids: [
          [1.5, 6.2, 4, 1.6],
          [8, 9, 5, 4],
        ],
      },
    ],
    connectors: [
      {
        entityId: id + '-stairs',
        type: 'stairs',
        from: { levelId: 'L1', point: [1, 7] },
        to: { levelId: 'L2', point: [6, 7] },
        width: 1.6,
      },
    ],
    source: {
      kind: 'original-synthetic',
      measured: ['Original dimensioned fixture, metres'],
      inferred: ['3.6 m floor height', 'Concept furniture'],
      unknown: ['School-specific content is intentionally absent'],
    },
  };
}
export function packageFor(scene, spaceId, name) {
  return {
    protocol: PROTOCOL,
    baseVersion: BASE_VERSION,
    spaceId,
    name,
    description: '可由 Agent 续建的独立空间示例',
    theme: { accent: '#2b6860' },
    scenes: [scene],
    spawn: { sceneId: scene.sceneId, levelId: scene.entry.levelId, point: [-3, 0, scene.entry.z] },
    knowledge: [
      {
        id: 'welcome',
        title: '访问须知',
        body: name + '是虚拟示例，公众可参观一层展览与二层工作室；需要进一步咨询可在接待处留言。',
        keywords: ['你好', '参观', '访问', '学校', '介绍'],
        published: true,
        revision: 1,
      },
      {
        id: 'gallery',
        title: '项目展览',
        body: '项目展厅位于一层北侧。这里展示学生项目的目标、过程、图片与公开成果；资料由空间维护者发布。',
        keywords: ['展览', '项目', '位置', 'gallery', 'project'],
        published: true,
        revision: 1,
        sceneId: scene.sceneId,
        entityId: scene.levels[0].rooms[0].entityId,
      },
      {
        id: 'hours',
        title: '开放时间',
        body: '示例空间线上开放时间为每日 09:00–21:00；实体建筑开放时间需要学校维护者另行核实。',
        keywords: ['几点', '时间', 'hours', 'open'],
        published: true,
        revision: 1,
      },
      {
        id: 'private-note',
        title: '内部维护记录',
        body: 'PRIVATE_FIXTURE_NOT_FOR_PUBLIC_RECEPTION',
        published: false,
      },
    ],
    agents: [
      {
        agentId: spaceId + '-reception',
        name: name + '接待 Agent',
        skills: ['space.information', 'navigation.route', 'message.leave'],
      },
    ],
    source: { kind: scene.source.kind },
    contacts: { public: '请通过接待 Agent 留言联系维护者' },
  };
}
export async function createExamples(root) {
  for (const [id, name, v] of [
    ['north', '北岸示例空间', 0],
    ['south', '南岸示例空间', 1],
  ]) {
    try {
      await readFile(join(root, 'examples', id, 'space.json'));
      continue;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const s = exampleScene(id + '-hall', v);
    await save(join(root, 'examples', id, 'space.json'), packageFor(s, id, name));
    const labels = s.levels[0].rooms
      .map(
        (r) =>
          '<text x="' +
          (r.rect[0] + 0.2) * 20 +
          '" y="' +
          (r.rect[1] + 2) * 20 +
          '" font-size="14">' +
          r.name +
          '</text>',
      )
      .join('');
    const rooms = s.levels[0].rooms
      .map(
        (r) =>
          '<rect x="' +
          r.rect[0] * 20 +
          '" y="' +
          r.rect[1] * 20 +
          '" width="' +
          r.rect[2] * 20 +
          '" height="' +
          r.rect[3] * 20 +
          '" fill="#ece6d9" stroke="#345d56"/>',
      )
      .join('');
    await writeFile(
      join(root, 'examples', id, 'plan.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="-40 -40 600 440"><rect width="' +
        s.size[0] * 20 +
        '" height="' +
        s.size[1] * 20 +
        '" fill="#faf8ef" stroke="#345d56" stroke-width="3"/>' +
        rooms +
        labels +
        '<text y="-15" font-size="16">Original synthetic plan · ' +
        s.size.join(' × ') +
        ' metres</text></svg>',
    );
  }
}
