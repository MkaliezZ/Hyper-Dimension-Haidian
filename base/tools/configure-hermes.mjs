import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2),
  flag = (n) => {
    const i = args.indexOf('--' + n);
    return i < 0 ? undefined : args[i + 1];
  };
try {
  if (!flag('python') || !flag('hermes-root'))
    throw Error('Use --python <venv Python> --hermes-root <Hermes installation> [--data .local]');
  const python = resolve(flag('python')),
    hermesRoot = resolve(flag('hermes-root')),
    data = resolve(flag('data') || '.local');
  await stat(python);
  await stat(join(hermesRoot, 'run_agent.py'));
  await mkdir(data, { recursive: true });
  await writeFile(
    join(data, 'reception.json'),
    JSON.stringify({ provider: 'hermes', python, hermesRoot, timeoutMs: 60000 }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created private reception.json. No API key was written. Inject DEEPSEEK_API_KEY into the launch environment, then restart Base.',
  );
} catch (e) {
  console.error(
    e.code === 'EEXIST'
      ? 'Existing configuration preserved; edit it deliberately or use another --data directory.'
      : e.message,
  );
  process.exitCode = 1;
}
