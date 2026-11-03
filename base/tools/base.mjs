import { readFile, writeFile, mkdir, copyFile, stat, readdir, unlink } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { vendor } from './vendor.mjs';
import { createExamples, packageFor, exampleScene } from './fixtures.mjs';
import { loadPackages, startServer } from '../src/server.mjs';
import { buildModel, makeGlb } from '../src/spatial/model.mjs';
import { createNavigation, roomPoint } from '../src/spatial/building.mjs';
import { digest, BASE_VERSION } from '../src/protocol/index.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  args = process.argv.slice(2),
  command = args.shift() || 'serve';
const flag = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : undefined;
  },
  exists = async (path) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };
const paths = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--space') paths.push(resolve(args[++i]));
if (!paths.length)
  paths.push(join(root, 'examples/north/space.json'), join(root, 'examples/south/space.json'));
async function verify(packs) {
  const report = { at: new Date().toISOString(), kind: 'automated-spatial-contract', spaces: [] };
  for (const p of packs) {
    const scenes = [];
    for (const s of p.scenes) {
      const nav = createNavigation(s),
        from =
          s.sceneId === p.spawn.sceneId ? { levelId: p.spawn.levelId, point: p.spawn.point } : null;
      if (!from)
        throw Error(
          'Every scene needs an explicit transition/spawn configuration in this reference runtime',
        );
      const rooms = [];
      for (const l of s.levels)
        for (const r of l.rooms || []) {
          if (r.access !== 'public') continue;
          const [x, z] = roomPoint(r),
            route = nav.route(from, { levelId: l.id, point: [x, l.elevation, z] });
          if (!route.path.length) throw Error('Empty route');
          rooms.push({ entityId: r.entityId, levelId: l.id, distance: route.distance });
        }
      const glb = makeGlb(s),
        len = glb.readUInt32LE(12),
        meta = JSON.parse(glb.subarray(20, 20 + len).toString());
      if (meta.extras.geometryHash !== digest(s)) throw Error('Model/navigation geometry mismatch');
      scenes.push({ sceneId: s.sceneId, geometryHash: digest(s), nodes: nav.nodeCount, rooms });
    }
    report.spaces.push({ spaceId: p.spaceId, scenes });
  }
  return report;
}
try {
  if (command === 'setup') {
    if (!(await exists(join(root, 'examples/north/space.json')))) await createExamples(root);
    await vendor(root);
    console.log('Setup complete. No user project or state was overwritten.');
  } else if (command === 'doctor') {
    const checks = {
      node: process.version,
      supportedNode: Number(process.versions.node.split('.')[0]) >= 22,
      vendor: await exists(join(root, 'public/vendor/three/three.module.js')),
      examples: await exists(paths[0]),
      writeableRoot: await exists(root),
      platform: process.platform,
    };
    console.log(JSON.stringify(checks, null, 2));
    if (!checks.supportedNode || !checks.vendor || !checks.examples) process.exitCode = 1;
  } else if (command === 'scaffold') {
    const dest = flag('out'),
      id = flag('id');
    if (!dest || !id) throw Error('scaffold --id <stable-id> --out <new-directory>');
    const dir = resolve(dest);
    if (await exists(dir)) throw Error('Refusing to overwrite existing project directory');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'space.json'),
      JSON.stringify(packageFor(exampleScene(id + '-hall'), id, id + ' 空间'), null, 2) + '\n',
    );
    console.log('Created ' + join(dir, 'space.json'));
  } else if (command === 'build') {
    const packs = await loadPackages(paths);
    for (const pack of packs)
      for (const scene of pack.scenes)
        console.log(
          JSON.stringify(await buildModel(scene, join(root, 'dist', pack.spaceId, scene.sceneId))),
        );
  } else if (command === 'verify') {
    const report = await verify(await loadPackages(paths));
    await mkdir(join(root, 'qa'), { recursive: true });
    await writeFile(
      join(root, 'qa', 'spatial-verification.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report, null, 2));
  } else if (command === 'serve') {
    const server = await startServer({
      root,
      packs: await loadPackages(paths),
      dataDir: resolve(flag('data') || join(root, '.local')),
      host: flag('host') || '127.0.0.1',
      port: Number(flag('port') || 4180),
      allowLan: args.includes('--lan'),
      publicOrigin: flag('origin'),
    });
    console.log(
      'Hyper Dimension Base ' + server.origin + ' (private credentials: ' + server.auth.path + ')',
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, () => void server.close().then(() => process.exit(0)));
  } else if (command === 'recover-lock') {
    const dir = resolve(flag('data') || join(root, '.local')),
      path = join(dir, 'base.lock'),
      owner = JSON.parse(await readFile(path, 'utf8'));
    try {
      process.kill(owner.pid, 0);
      throw Error('Lock owner is alive. Nothing removed.');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
    const second = JSON.parse(await readFile(path, 'utf8'));
    if (second.pid !== owner.pid || second.token !== owner.token)
      throw Error('Lock changed; preserved');
    await unlink(path);
    console.log('Removed a verified dead-process lock only. Persistent state preserved.');
  } else if (command === 'pack') {
    const { packComplete } = await import('./pack.mjs');
    console.log(
      JSON.stringify(
        await packComplete(
          root,
          resolve(flag('out') || join(root, 'dist', `Hyper-Dimension-Base-v${BASE_VERSION}-Complete.zip`)),
        ),
        null,
        2,
      ),
    );
  } else throw Error('Unknown command: ' + command);
} catch (error) {
  console.error(error.code ? error.code + ': ' + error.message : error.message);
  process.exitCode = 1;
}
