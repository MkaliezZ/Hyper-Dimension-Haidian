import { randomUUID } from 'node:crypto';
import { applyForumEvent, drainOutbox } from './ledger.mjs';
import { hash, problem } from './db.mjs';
// Each source and school must get its turn even while another source needs repair.
export async function reconcileSteps(steps) {
  const failures = [];
  for (const { schoolId, stage, run } of steps) {
    try {
      await run();
    } catch {
      failures.push({ schoolId, stage });
    }
  }
  if (failures.length) {
    const error = problem('source_reconciliation_incomplete', 503);
    error.failures = failures;
    throw error;
  }
}
export async function reconcileSchool(db, services, s) {
  const lock = await db.pool.connect(),
    key = s.schoolId + ':source-reconciliation';
  if (
    !(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok', [key])).rows[0]
      .ok
  ) {
    lock.release();
    return { busy: true };
  }
  const result = {
    schoolId: s.schoolId,
    recovered: [],
    blocked: [],
    applied: 0,
    projectionRepairs: 0,
  };
  try {
    const source = await services.forum(s, 'reconcile', {});
    result.recovered = source.recovered;
    result.blocked = source.blocked;
    const { events } = await services.forum(s, 'events', {}),
      ids = new Set();
    for (const e of events) {
      ids.add(e.eventId);
      const r = await applyForumEvent(db, s.schoolId, e);
      if (!r.duplicate) result.applied++;
    }
    const { rows: local } = await db.pool.query(
      "SELECT event_id FROM hd_events WHERE school_id=$1 AND envelope->'source'->>'system'='nodebb'",
      [s.schoolId],
    );
    for (const row of local)
      if (!ids.has(row.event_id))
        result.blocked.push({ eventId: row.event_id, reason: 'source_event_missing' });
    const rows = (
      await db.pool.query(
        `SELECT user_id,period FROM hd_contributions WHERE school_id=$1 UNION SELECT user_id,period FROM hd_scores WHERE school_id=$1`,
        [s.schoolId],
      )
    ).rows;
    for (const row of rows)
      await db.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          s.schoolId + ':ledger',
        ]);
        row.score = (
          await c.query(
            'SELECT coalesce(sum(delta),0)::int AS score FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND period=$3',
            [s.schoolId, row.user_id, row.period],
          )
        ).rows[0].score;
        const {
          rows: [current],
        } = await c.query(
          'SELECT * FROM hd_scores WHERE school_id=$1 AND user_id=$2 AND period=$3 FOR UPDATE',
          [s.schoolId, row.user_id, row.period],
        );
        if (!current || current.score !== row.score) {
          const version = (current?.version || 0) + 1;
          await c.query(
            'INSERT INTO hd_scores VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,user_id,period) DO UPDATE SET score=EXCLUDED.score,version=EXCLUDED.version',
            [s.schoolId, row.user_id, row.period, row.score, version],
          );
          await c.query(
            'INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES($1,$2,$3,$4,$5)',
            [s.schoolId, row.user_id, row.period, row.score, version],
          );
          result.projectionRepairs++;
        }
      });
    await drainOutbox(db, (row) => services.project(row));
    const last = (
      await db.pool.query(
        'SELECT result FROM hd_reconciliations WHERE school_id=$1 ORDER BY occurred_at DESC LIMIT 1',
        [s.schoolId],
      )
    ).rows[0];
    if (
      result.applied ||
      result.recovered.length ||
      result.projectionRepairs ||
      hash(last?.result?.blocked || []) !== hash(result.blocked)
    )
      await db.pool.query(
        'INSERT INTO hd_reconciliations(run_id,school_id,result) VALUES($1,$2,$3)',
        [randomUUID(), s.schoolId, result],
      );
    return result;
  } finally {
    await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
    lock.release();
  }
}
