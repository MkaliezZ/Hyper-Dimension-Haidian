import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPlatform } from '../src/platform/index.mjs';
import { startServer, loadPackages } from '../src/server.mjs';
const path = process.env.HD_M0_CONFIG;
if (!path) throw Error('Set HD_M0_CONFIG to a private JSON configuration file; see docs/M0.md');
const config = JSON.parse(await readFile(path, 'utf8'));
const platform = await createPlatform(config);
await mkdir(config.dataDir, { recursive: true });
try {
  const server = await startServer({
    root: process.cwd(),
    packs: platform.augmentPacks(await loadPackages(config.schools.map((s) => resolve(s.package)))),
    capabilities: platform.capabilities,
    dataDir: config.dataDir,
    port: config.port || new URL(config.origin).port || 4280,
    host: '127.0.0.1',
    publicOrigin: config.origin,
    allowLan: true,
    platform,
  });
  console.log(
    JSON.stringify({
      origin: server.origin,
      mode: 'M0',
      schools: config.schools.map((s) => s.schoolId),
    }),
  );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await server.close();
    await platform.close();
    process.exit(0);
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch (e) {
  await platform.close();
  throw e;
}
