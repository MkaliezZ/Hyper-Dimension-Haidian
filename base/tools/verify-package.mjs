import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const manifest = JSON.parse(await readFile(resolve(root, 'PACKAGE-MANIFEST.json'), 'utf8'));
  for (const f of manifest.files) {
    const path = await realpath(resolve(root, f.path));
    if (!path.startsWith(root + sep)) throw Error('Manifest path escaped package');
    const b = await readFile(path);
    if (b.length !== f.bytes || createHash('sha256').update(b).digest('hex') !== f.sha256)
      throw Error('Changed/missing file: ' + f.path);
  }
  console.log(
    `PASS: ${manifest.files.length} packaged files matched SHA-256. Runtime data created after startup is outside this manifest.`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
