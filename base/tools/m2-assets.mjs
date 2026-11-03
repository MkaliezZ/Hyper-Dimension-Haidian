import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { catalogM2 as originalCatalog } from '../src/avatar/model-m2.mjs';
import { catalogM2, partM2, avatarM2 } from '../src/avatar/model-m2-v2.mjs';
const version =
  process.argv.find((x) => x.startsWith('--version='))?.slice(10) || 'campus-original-2';
if (!['campus-original-1', 'campus-original-2'].includes(version))
  throw Error('Unknown catalog version');
// Published first-version assets are immutable. Verify before generating the additive library.
const original = originalCatalog();
for (const part of original.parts) {
  const bytes = await readFile(join('assets/avatars/parts', part.id + '.glb'));
  if (createHash('sha256').update(bytes).digest('hex') !== part.sha256)
    throw Error('Original asset changed: ' + part.id);
}
if (version === 'campus-original-1') {
  console.log(
    JSON.stringify({ version, originalPartsVerified: original.parts.length, preserved: true }),
  );
} else {
  const root = 'assets/avatars/v2',
    catalog = catalogM2();
  await mkdir(join(root, 'parts'), { recursive: true });
  await mkdir(join(root, 'presets'), { recursive: true });
  for (const p of catalog.parts) await writeFile(join(root, 'parts', p.id + '.glb'), partM2(p.id));
  for (const preset of catalog.presets)
    await writeFile(join(root, 'presets', preset.id + '.glb'), avatarM2(preset.recipe));
  await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  await writeFile(join(root, 'LICENSE'), await readFile('assets/avatars/LICENSE'));
  await writeFile(
    join(root, 'PROVENANCE.md'),
    '# Campus Original Expanded\n\nAll 38 parts and four presets are original deterministic procedural geometry created for Hyper Dimension Base.\nSource: src/avatar/catalog-m2-v2.mjs and model-m2-v2.mjs. MIT license. No third-party meshes or textures.\nShared skeleton campus-humanoid-1; generator campus-rig-2.0.0. Each catalog item records its SHA-256, version, slot, source and license.\nPublished campus-original-1 assets and generator remain available unchanged. Switching catalogs requires explicit user confirmation.\n',
  );
  console.log(
    JSON.stringify({
      version: catalog.version,
      parts: catalog.parts.length,
      presets: catalog.presets.length,
      catalogHash: catalog.catalogHash,
      originalPartsPreserved: original.parts.length,
    }),
  );
}
