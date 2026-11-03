import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { catalogM2 as first } from '../src/avatar/model-m2.mjs';
import { catalogM2 as second } from '../src/avatar/model-m2-v2.mjs';
import { catalogM2, partM2 } from '../src/avatar/model-m2-v3.mjs';
import { REWARD_PART } from '../src/avatar/catalog-m2-v3.mjs';
let preserved = 0;
for (const catalog of [first(), second()])
  for (const p of catalog.parts) {
    const file = 'assets/avatars/' + p.asset.replace('/avatar-library/', '');
    const b = await readFile(file);
    if (createHash('sha256').update(b).digest('hex') !== p.sha256)
      throw Error('Existing original asset differs: ' + p.id);
    preserved++;
  }
await mkdir('assets/avatars/v3/parts', { recursive: true });
await writeFile('assets/avatars/v3/parts/' + REWARD_PART + '.glb', partM2(REWARD_PART));
await writeFile('assets/avatars/v3/catalog.json', JSON.stringify(catalogM2(), null, 2) + '\n');
await writeFile('assets/avatars/v3/LICENSE', await readFile('assets/avatars/LICENSE'));
await writeFile(
  'assets/avatars/v3/PROVENANCE.md',
  '# Optional reward appearance\n\nOne original procedural community ribbon (MIT). Generator: src/avatar/model-m2-v3.mjs, catalog-m2-v3.mjs; shared campus-humanoid-1 skeleton. All prior v1/v2 assets are referenced unchanged. Rebuild: node tools/rewards-assets.mjs. Opt-in catalog transition and current server-issued M2 inventory entitlement are required to save/preview/export the ribbon. No retroactive lock on previously open parts.\n',
);
console.log(
  JSON.stringify({
    preservedOriginalParts: preserved,
    newParts: 1,
    catalogVersion: catalogM2().version,
    catalogHash: catalogM2().catalogHash,
  }),
);
