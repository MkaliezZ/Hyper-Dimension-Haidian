import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../protocol/index.mjs';
import { receptionInstructions } from './index.mjs';

export async function localHermesProvider({
  python,
  hermesRoot,
  dataDir,
  timeoutMs = 60000,
  spawnImpl = spawn,
}) {
  if (!python || !hermesRoot) fail('hermes_config', 'Hermes requires python and hermesRoot');
  python = resolve(python);
  hermesRoot = resolve(hermesRoot);
  await stat(python);
  await stat(join(hermesRoot, 'run_agent.py'));
  const home = resolve(dataDir, 'hermes-reception');
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
    fail('hermes_config', 'Hermes timeout must be 1000–120000ms');
  const bridge = fileURLToPath(new URL('./hermes_bridge.py', import.meta.url));
  const provider = async ({ message, facts, space, history = [], signal }) => {
    if (signal?.aborted) throw signal.reason;
    if (!process.env.DEEPSEEK_API_KEY)
      fail('provider_unavailable', 'Hermes needs DEEPSEEK_API_KEY', 503);
    const env = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG'])
      if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, {
      HERMES_HOME: home,
      HD_HERMES_ROOT: hermesRoot,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      HERMES_IGNORE_USER_CONFIG: '1',
      HERMES_IGNORE_RULES: '1',
      HERMES_SAFE_MODE: '1',
    });
    const output = await new Promise((accept, reject) => {
      const child = spawnImpl(python, [bridge], {
        cwd: home,
        env,
        shell: false,
        windowsHide: true,
      });
      const chunks = [];
      let size = 0,
        settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) {
          child.kill();
          reject(error);
        } else accept(value);
      };
      const abort = () =>
        finish(Object.assign(Error('Hermes request canceled'), { code: 'provider_unavailable' }));
      const timer = setTimeout(
        () =>
          finish(
            Object.assign(Error('Hermes request timed out'), { code: 'provider_unavailable' }),
          ),
        timeoutMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.on('error', () =>
        finish(
          Object.assign(Error('Local Hermes could not start'), { code: 'provider_unavailable' }),
        ),
      );
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > 131072)
          return finish(
            Object.assign(Error('Hermes output exceeded limit'), { code: 'provider_unavailable' }),
          );
        chunks.push(chunk);
      });
      // The runtime may log internally. Never relay its diagnostics or credentials to a visitor.
      child.stderr.resume();
      child.on('close', (code) =>
        code === 0
          ? finish(null, Buffer.concat(chunks).toString('utf8'))
          : finish(
              Object.assign(Error('Local Hermes request failed'), { code: 'provider_unavailable' }),
            ),
      );
      child.stdin.on('error', () => {});
      child.stdin.end(
        JSON.stringify({
          instructions: receptionInstructions(space),
          question: message,
          publishedFacts: facts,
          history,
        }),
      );
    });
    let result;
    try {
      result = JSON.parse(output);
    } catch {
      fail('provider_invalid', 'Hermes returned invalid JSON', 502);
    }
    if (result.transport !== 'local-hermes' || result.toolCount !== 0)
      fail('provider_invalid', 'Hermes reception must run with zero tools', 502);
    return result;
  };
  provider.general = true;
  provider.providerName = 'hermes';
  return provider;
}

export async function configuredHermes(dataDir) {
  const path = process.env.HDBASE_RECEPTION_CONFIG || join(dataDir, 'reception.json');
  let config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (config.provider !== 'hermes') fail('hermes_config', 'Unsupported reception provider');
  return localHermesProvider({ ...config, dataDir });
}
