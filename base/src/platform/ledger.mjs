import { hash, problem } from './db.mjs';
import { canonical } from '../protocol/index.mjs';
// Rule is an explicitly fictional M0 fixture, not the user's future operations policy.
export const RULE = 'm0-content-accepted-v1';
export async function applyForumEvent(db, school, e) {
  if (db.campusEnabled) {
    if (e?.schoolId !== school || e.source?.system !== 'nodebb')
      throw problem('invalid_source_event');
    if (!db.recordCampusContribution) throw problem('campus_ledger_unavailable', 503);
    return db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        school + ':permissions',
      ]);
      return db.recordCampusContribution(c, e);
    });
  }
  if (
    e.schoolId !== school ||
    e.schema !== 'hyper-dimension.event/v1' ||
    e.source?.system !== 'nodebb' ||
    !Number.isSafeInteger(e.source.revision) ||
    e.source.revision < 1 ||
    !['published', 'withdrawn'].includes(e.status) ||
    e.period !== 'm0-trial' ||
    e.actor?.kind !== 'human' ||
    typeof e.actor?.userId !== 'string' ||
    !/^[a-zA-Z0-9._:-]{1,128}$/.test(e.source.id || '') ||
    e.eventId !== `${school}:nodebb:${e.source.id}:${e.source.revision}`
  )
    throw problem('invalid_source_event');
  return db.tx(async (c) => {
    if (db.m1)
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [school + ':ledger']);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      school + ':' + e.source.id,
    ]);
    const {
      rows: [old],
    } = await c.query('SELECT * FROM hd_events WHERE event_id=$1', [e.eventId]);
    if (old) {
      if (old.input_hash !== hash(canonical(e)) && canonical(old.envelope) !== canonical(e))
        throw problem('event_conflict', 409);
      return { duplicate: true };
    }
    if (db.m1) {
      if (
        !(
          await c.query('SELECT 1 FROM hd_memberships WHERE school_id=$1 AND user_id=$2', [
            school,
            e.subject.userId,
          ])
        ).rowCount
      )
        throw problem('event_subject_unknown');
    } else await db.member(school, e.subject.userId, null, c);
    const {
      rows: [head],
    } = await c.query('SELECT * FROM hd_forum_heads WHERE school_id=$1 AND source_id=$2', [
      school,
      e.source.id,
    ]);
    if (
      e.source.revision !== (head?.revision || 0) + 1 ||
      (head && head.user_id !== e.subject.userId)
    )
      throw problem('source_revision_conflict', 409);
    await c.query('INSERT INTO hd_events VALUES($1,$2,$3,$4,$5,$6)', [
      e.eventId,
      school,
      e.source.id,
      e.source.revision,
      e,
      hash(canonical(e)),
    ]);
    const wasPublished = head?.status === 'published',
      isPublished = e.status === 'published';
    const delta = (isPublished ? 10 : 0) - (wasPublished ? 10 : 0);
    const {
      rows: [previous],
    } = await c.query(
      `SELECT id FROM hd_contributions WHERE school_id=$1 AND event_id IN
      (SELECT event_id FROM hd_events WHERE school_id=$1 AND source_id=$2) AND delta>0 ORDER BY id DESC LIMIT 1`,
      [school, e.source.id],
    );
    await c.query(
      `INSERT INTO hd_forum_heads VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,source_id)
      DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status`,
      [school, e.source.id, e.source.revision, e.status, e.subject.userId],
    );
    if (delta) {
      await c.query(
        `INSERT INTO hd_contributions(event_id,school_id,user_id,period,delta,rule_version,reverses) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          e.eventId,
          school,
          e.subject.userId,
          e.period,
          delta,
          RULE,
          delta < 0 ? previous?.id : null,
        ],
      );
      const {
        rows: [score],
      } = await c.query(
        `INSERT INTO hd_scores VALUES($1,$2,$3,$4,1) ON CONFLICT(school_id,user_id,period)
        DO UPDATE SET score=hd_scores.score+EXCLUDED.score,version=hd_scores.version+1 RETURNING *`,
        [school, e.subject.userId, e.period, delta],
      );
      await c.query(
        `INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES($1,$2,$3,$4,$5)`,
        [school, e.subject.userId, e.period, score.score, score.version],
      );
    }
    if (db.m1)
      await c.query(
        'INSERT INTO hd_notifications(school_id,user_id,event_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [
          school,
          e.subject.userId,
          e.eventId,
          {
            sourceId: e.source.id,
            status: e.status,
            delta,
            organizationId: e.organizationId || null,
          },
        ],
      );
    return { duplicate: false, delta, ruleVersion: RULE };
  });
}
export async function drainOutbox(db, project) {
  // Coordinate scheduler/manual/recovery workers across processes. A failed delivery stays pending.
  const c = await db.pool.connect(),
    key = 'hyper-dimension:score-outbox';
  let locked = false;
  try {
    locked = (await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key]))
      .rows[0].locked;
    if (!locked) return 0;
    // Bound this pass to a stable high-water mark. Keyset pages advance past failed
    // rows; the first 100 unavailable users must not starve later schools forever.
    const ceiling = (await c.query('SELECT max(id) AS ceiling FROM hd_outbox WHERE NOT delivered'))
      .rows[0].ceiling;
    if (ceiling === null) return 0;
    const blocked = new Set(),
      failures = [];
    let after = '0',
      delivered = 0,
      firstError;
    while (true) {
      const { rows } = await c.query(
        'SELECT * FROM hd_outbox WHERE NOT delivered AND id>$1::bigint AND id<=$2::bigint ORDER BY id LIMIT 100',
        [after, ceiling],
      );
      if (!rows.length) break;
      for (const row of rows) {
        after = String(row.id);
        const stream = JSON.stringify([row.school_id, row.user_id, row.period]);
        if (blocked.has(stream)) continue;
        await c.query(
          db.campusEnabled
            ? 'UPDATE hd_outbox SET attempts=attempts+1,last_attempt_at=now() WHERE id=$1'
            : 'UPDATE hd_outbox SET attempts=attempts+1 WHERE id=$1',
          [row.id],
        );
        try {
          await project(row);
        } catch (error) {
          blocked.add(stream);
          firstError ||= error instanceof Error ? error : problem('outbox_projection_failed', 503);
          // Store a stable category, never upstream bodies, URLs, credentials or arbitrary text.
          const code = [401, 403].includes(error?.status)
            ? 'projection_identity_unavailable'
            : error?.status === 503 || ['TimeoutError', 'AbortError'].includes(error?.name)
              ? 'projection_service_unavailable'
              : 'projection_failed';
          failures.push({
            id: String(row.id),
            schoolId: row.school_id,
            userId: row.user_id,
            period: row.period,
            version: row.version,
            code,
          });
          if (db.campusEnabled)
            await c.query('UPDATE hd_outbox SET last_error_code=$2 WHERE id=$1', [row.id, code]);
          continue;
        }
        await c.query(
          db.campusEnabled
            ? 'UPDATE hd_outbox SET delivered=true,last_error_code=NULL WHERE id=$1'
            : 'UPDATE hd_outbox SET delivered=true WHERE id=$1',
          [row.id],
        );
        delivered++;
      }
    }
    if (firstError) {
      firstError.outbox = { delivered, failures, blockedStreams: blocked.size };
      throw firstError; // Healthy subjects progressed, but the overall health must remain failed.
    }
    return delivered;
  } finally {
    try {
      if (locked) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
    } finally {
      c.release();
    }
  }
}
