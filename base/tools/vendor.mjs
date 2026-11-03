import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function vendor(root) {
  for (const [from, to] of [
    ['build/three.module.js', 'three.module.js'],
    ['build/three.core.js', 'three.core.js'],
    ['examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'],
    ['examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'],
    ['examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'],
    ['examples/jsm/utils/SkeletonUtils.js', 'addons/utils/SkeletonUtils.js'],
    ['LICENSE', 'LICENSE'],
  ]) {
    const dest = join(root, 'public/vendor/three', to);
    await mkdir(join(dest, '..'), { recursive: true });
    await copyFile(join(root, 'node_modules/three', from), dest);
  }
  await mkdir(join(root, 'public/vendor/vrm'), { recursive: true });
  for (const [from, to] of [
    ['lib/three-vrm.module.js', 'three-vrm.module.js'],
    ['LICENSE', 'LICENSE'],
  ])
    await copyFile(
      join(root, 'node_modules/@pixiv/three-vrm', from),
      join(root, 'public/vendor/vrm', to),
    );
}
