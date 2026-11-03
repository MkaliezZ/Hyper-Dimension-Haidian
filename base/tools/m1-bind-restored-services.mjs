import { readFile, writeFile, cp, mkdir, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2),
  opt = (k) => args[args.indexOf(k) + 1];
if (!['--runtime', '--binaries'].every((k) => args.includes(k)))
  throw Error(
    'm1-bind-restored-services --runtime RESTORED_NEW_ROOT --binaries PINNED_INSTALLED_SERVICE_ROOT',
  );
const root = resolve(opt('--runtime')),
  source = resolve(opt('--binaries')),
  reportPath = join(root, 'restore-report.json'),
  report = JSON.parse(await readFile(reportPath, 'utf8'));
if (root === source || report.status !== 'RESTORED_NEEDS_BINARY_BINDING_AND_CLIENT_RELOCATION')
  throw Error('Only a new restored clone can be bound');
for (const name of ['node', 'nakama', 'keycloak', 'nodebb']) {
  const target = join(root, name);
  try {
    await lstat(target);
    throw Error('Binary target exists; no overwrite: ' + name);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const base = join(source, name);
  await cp(base, target, {
    recursive: true,
    dereference: true,
    filter: (p) =>
      ![
        'keycloak/data',
        'keycloak/conf',
        'keycloak/themes/hd-base',
        'nodebb/public/uploads',
        'nodebb/logs',
      ].some((x) => p === join(source, x) || p.startsWith(join(source, x) + '/')),
  });
}
for (const [from, to] of [
  ['keycloak-conf', 'keycloak/conf'],
  ['keycloak-import', 'keycloak/data/import'],
  ['keycloak-theme', 'keycloak/themes/hd-base'],
  ['forum-uploads', 'nodebb/public/uploads'],
]) {
  await mkdir(join(root, to), { recursive: true });
  await cp(join(root, from), join(root, to), { recursive: true });
}
report.status = 'READY_TO_START_AND_RELOCATE_CLIENT';
try {
  const knowledgePath = join(root, 'base-data/knowledge.json');
  const knowledge = JSON.parse(await readFile(knowledgePath, 'utf8'));
  if (knowledge.embedding?.provider === 'onnx') {
    const rel = relative(source, knowledge.embedding.python);
    if (rel === 'embedding-venv/bin/python') {
      await cp(join(source, 'embedding-venv'), join(root, 'embedding-venv'), {
        recursive: true,
        dereference: true,
        errorOnExist: true,
        force: false,
      });
      knowledge.embedding.python = join(root, rel);
      await writeFile(knowledgePath, JSON.stringify(knowledge, null, 2) + '\n', { mode: 0o600 });
    } else {
      report.externalEmbeddingRuntime = knowledge.embedding.python;
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const patch = spawn(process.execPath, ['tools/m0-patch-nodebb.cjs', join(root, 'nodebb')], {
  stdio: 'inherit',
});
if ((await new Promise((r) => patch.on('exit', r))) !== 0)
  throw Error('Restored isolation plugin installation failed; no service started');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(
  'Pinned binaries and restored files bound into the independent clone; source untouched',
);
