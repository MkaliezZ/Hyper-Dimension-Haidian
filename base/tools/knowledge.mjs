import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackages } from '../src/server.mjs';
import { openKnowledge } from '../src/knowledge/index.mjs';
const args = process.argv.slice(2),
  command = args.shift();
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = resolve(fileURLToPath(new URL('..', import.meta.url))),
  dataDir = resolve(flag('data') || join(root, '.local'));
let knowledge;
try {
  if (command === 'recover-lock') {
    const path = join(dataDir, 'knowledge.lock'),
      owner = JSON.parse(await readFile(path, 'utf8'));
    try {
      process.kill(owner.pid, 0);
      throw Error('Knowledge lock owner is alive; preserved.');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
    const again = JSON.parse(await readFile(path, 'utf8'));
    if (again.pid !== owner.pid || again.token !== owner.token)
      throw Error('Knowledge lock changed; preserved.');
    await unlink(path);
    console.log('Verified dead-process knowledge lock removed; database preserved.');
  } else if (command === 'configure') {
    const python = flag('python');
    if (!python)
      throw Error(
        'configure --python <embedding Python> [--database pglite|postgres] [--data <dir>]',
      );
    const config = {
      database: { provider: flag('database') || 'pglite', connectionEnv: 'HDBASE_DATABASE_URL' },
      embedding: {
        provider: 'onnx',
        python: resolve(python),
        modelDir: 'models/bge-small-zh-v1.5',
      },
      topK: 4,
      minScore: 0.45,
    };
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'knowledge.json'), JSON.stringify(config, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log('Created private knowledge.json without credentials. Next: init, then import.');
  } else {
    knowledge = await openKnowledge({ dataDir, root, migrate: command === 'init' });
    if (!knowledge) throw Error('No knowledge.json: run configure first.');
    if (command === 'init') console.log('PostgreSQL + pgvector schema ready.');
    else {
      const path = flag('space');
      if (!path) throw Error('Provide --space <space.json>');
      const [pack] = await loadPackages([resolve(path)]);
      if (command === 'import') {
        if (!flag('input'))
          throw Error('import --space <space.json> --input <reviewed-documents.json>');
        const raw = await readFile(resolve(flag('input')), 'utf8');
        if (raw.length > 4 * 1024 * 1024)
          throw Error('Input exceeds 4MB; split/review documents first');
        console.log(
          JSON.stringify(
            await knowledge.import(pack.spaceId, JSON.parse(raw.replace(/^\uFEFF/, '')), {
              replace: args.includes('--replace'),
            }),
            null,
            2,
          ),
        );
      } else if (command === 'status')
        console.log(JSON.stringify(await knowledge.status(pack.spaceId), null, 2));
      else if (command === 'search')
        console.log(
          JSON.stringify(
            await knowledge.retrieve(
              pack,
              {
                id: 'local-maintainer',
                spaces: [pack.spaceId],
                scopes: ['a2a:call', 'public:read'],
              },
              flag('query') || '',
            ),
            null,
            2,
          ),
        );
      else throw Error('Commands: configure, init, import, status, search');
    }
  }
} catch (error) {
  console.error(
    error.code || 'knowledge_error',
    error.code?.startsWith('knowledge_') || ['ENOENT', 'EEXIST'].includes(error.code)
      ? error.message
      : 'Knowledge operation failed; check database/model configuration. No credentials were printed.',
  );
  process.exitCode = 1;
} finally {
  await knowledge?.close();
}
