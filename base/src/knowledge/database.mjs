import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openExclusiveFile, releaseOwnedLock } from '../core/atomic-json.mjs';
import { fail } from '../protocol/index.mjs';

export async function openKnowledgeDatabase(
  config,
  dataDir,
  { migrate = false, forumHistory = false } = {},
) {
  let db, owner;
  const lock = join(dataDir, 'knowledge.lock');
  try {
    if (config.provider === 'pglite') {
      await mkdir(dataDir, { recursive: true });
      try {
        const file = await openExclusiveFile(lock);
        owner = randomUUID();
        await file.writeFile(JSON.stringify({ pid: process.pid, token: owner }));
        await file.close();
      } catch (error) {
        if (error.code === 'EEXIST')
          fail(
            'knowledge_locked',
            'Knowledge database is open. Stop Base before import/backup; do not delete its data.',
          );
        throw error;
      }
      const { PGlite } = await import('@electric-sql/pglite');
      const { vector } = await import('@electric-sql/pglite-pgvector');
      const pg = await PGlite.create(join(dataDir, 'knowledge-postgres'), {
        extensions: { vector },
        relaxedDurability: false,
      });
      db = {
        query: (s, p) => pg.query(s, p),
        exec: (s) => pg.exec(s),
        transaction: (f) => pg.transaction(f),
        close: () => pg.close(),
      };
    } else if (config.provider === 'postgres') {
      const connectionString = process.env[config.connectionEnv || 'HDBASE_DATABASE_URL'];
      if (!connectionString)
        fail('knowledge_config', 'PostgreSQL connection environment is missing');
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000,
      });
      pool.on('error', () => {});
      db = {
        query: (s, p) => pool.query(s, p),
        exec: (s) => pool.query(s),
        close: () => pool.end(),
        async transaction(f) {
          const c = await pool.connect();
          try {
            await c.query('BEGIN');
            const result = await f(c);
            await c.query('COMMIT');
            return result;
          } catch (e) {
            await c.query('ROLLBACK');
            throw e;
          } finally {
            c.release();
          }
        },
      };
    } else fail('knowledge_config', 'Choose pglite or postgres database');
    if (migrate)
      await db.exec(
        await readFile(
          fileURLToPath(new URL('../../database/knowledge.sql', import.meta.url)),
          'utf8',
        ),
      );
    else await db.query('SELECT space_id FROM hdbase_kb.spaces LIMIT 0');
    if (migrate || forumHistory) {
      try {
        await db.query('SELECT source_id FROM hdbase_forum.heads LIMIT 0');
      } catch (e) {
        if (!['42P01', '3F000'].includes(e.code)) throw e;
        await db.exec(
          await readFile(new URL('../../database/knowledge-history.sql', import.meta.url), 'utf8'),
        );
      }
    }
    return {
      ...db,
      provider: config.provider,
      async close() {
        await db.close();
        if (owner) await releaseOwnedLock(lock, owner);
      },
    };
  } catch (error) {
    await db?.close().catch(() => {});
    if (owner) await releaseOwnedLock(lock, owner).catch(() => {});
    throw error;
  }
}
