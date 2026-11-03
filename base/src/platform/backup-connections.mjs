import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function databaseConnections(c) {
  const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
    result = [{ id: 'base', url: c.databaseUrl }];
  const kc = await json(join(c.configRoot, 'keycloak-env.json')),
    jdbc = new URL(kc.KC_DB_URL.slice(5));
  jdbc.username = kc.KC_DB_USERNAME;
  jdbc.password = kc.KC_DB_PASSWORD;
  result.push({ id: 'keycloak', url: jdbc.href });
  for (const s of c.schools) {
    const n = await json(join(c.configRoot, 'nakama-' + s.schoolId + '.json'));
    result.push({ id: s.schoolId + '_nakama', url: 'postgresql://' + n.database.address[0] });
    const f = (await json(join(c.configRoot, 'forum-' + s.schoolId + '.json'))).postgres;
    const u = new URL('postgresql://127.0.0.1');
    Object.assign(u, {
      hostname: f.host,
      port: String(f.port),
      username: f.username,
      password: f.password,
      pathname: '/' + f.database,
    });
    result.push({ id: s.schoolId + '_forum', url: u.href });
  }
  try {
    const k = await json(join(c.dataDir, 'knowledge.json'));
    if (k.database.provider === 'postgres') {
      let env = {};
      try {
        env = await json(join(c.configRoot, 'runtime-env.json'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const key = k.database.connectionEnv || 'HDBASE_DATABASE_URL',
        url = process.env[key] || env[key];
      if (!url) throw Error('Knowledge database connection missing; incomplete backup refused');
      result.push({ id: 'knowledge', url });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return result;
}
