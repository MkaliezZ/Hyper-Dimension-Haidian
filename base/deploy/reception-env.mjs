import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Only the Base role receives the model key; no secret is passed in an argv or stored in JSON.
export async function receptionEnvironment({ env, configRoot, installation = '/opt/hermes' }) {
  if (!env.HD_RECEPTION_PROVIDER) return env;
  if (env.HD_RECEPTION_PROVIDER !== 'hermes')
    throw Error('Unsupported container reception provider');
  if (!env.HD_RECEPTION_MODEL_KEY_FILE)
    throw Error('Provide the private reception model secret file');
  const key = (await readFile(env.HD_RECEPTION_MODEL_KEY_FILE, 'utf8')).trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key))
    throw Error('Invalid reception model secret file');
  const desired = {
    provider: 'hermes',
    python: join(installation, '.venv/bin/python'),
    hermesRoot: installation,
    timeoutMs: 60000,
  };
  await stat(desired.python);
  await stat(join(installation, 'run_agent.py'));
  const path = join(configRoot, 'reception-hermes.json');
  let existing;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(desired))
      throw Error('Existing Hermes container configuration differs; preserved for review');
  } else
    await writeFile(path, JSON.stringify(desired, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { ...env, HDBASE_RECEPTION_CONFIG: path, DEEPSEEK_API_KEY: key };
}
