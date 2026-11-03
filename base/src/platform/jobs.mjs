import { PgBoss } from 'pg-boss';
import { createHash } from 'node:crypto';
import { problem, hash } from './db.mjs';
import { fields, canonical } from '../protocol/index.mjs';
import { validId } from './permissions.mjs';

export const queueNames = {
  'activity-reminder': 'campus-activity-reminder',
  'forum-index': 'campus-forum-index',
  'knowledge-index': 'campus-knowledge-index',
};
function jobId(key) {
  const b = createHash('sha256').update(key).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 80;
  b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// pg-boss is scheduling authority. Business tables/receipts remain effect authority.
// Enqueue uses the caller's PostgreSQL transaction: no job survives a rolled-back business write.
export async function createJobs(
  config,
  { handlers = {}, schema = 'hd_campus_jobs', workers = true } = {},
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw problem('queue_schema_invalid');
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema,
    max: 3,
    application_name: 'hyper-dimension-jobs',
  });
  let lastError = null;
  boss.on('error', () => {
    lastError = 'queue_unavailable';
  });
  await boss.start();
  const dlq = 'campus-failed';
  await boss.createQueue(dlq);
  for (const name of Object.values(queueNames))
    await boss.createQueue(name, {
      retryLimit: 3,
      retryDelay: 1,
      retryBackoff: true,
      expireInSeconds: name === 'campus-activity-reminder' ? 30 : 120,
      deadLetter: dlq,
      deleteAfterSeconds: 604800,
    });
  const dispatch = async (job) => {
    const handler = handlers[job.data?.kind];
    if (!handler) throw Error('queue_handler_unavailable');
    if (!config.schools.some((s) => s.schoolId === job.data.schoolId))
      throw Error('queue_school_disabled');
    try {
      return await handler(job.data);
    } catch {
      throw Error('business_job_failed');
    } // Do not persist upstream responses or credentials in job output.
  };
  if (workers)
    for (const name of Object.values(queueNames))
      await boss.work(name, { pollingIntervalSeconds: 1, batchSize: 1 }, async (jobs) => {
        for (const job of jobs) await dispatch(job);
      });
  return {
    boss,
    schema,
    health: () => ({ healthy: !lastError, error: lastError }),
    async scheduleIndex(c, kind, { schoolId, sourceId, generation, cursor = 0 }) {
      if (
        !['forum-index', 'knowledge-index'].includes(kind) ||
        !config.schools.some((s) => s.schoolId === schoolId) ||
        !validId(sourceId) ||
        !/^[a-f0-9]{64}$/.test(generation) ||
        !Number.isSafeInteger(cursor) ||
        cursor < 0
      )
        throw problem('index_job_invalid');
      const sourceKey = sourceId + ':' + generation + ':' + cursor,
        id = jobId(schoolId + ':' + kind + ':' + sourceKey),
        data = { kind, schoolId, sourceId, generation, cursor };
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id]);
      const old = (await c.query('SELECT job_id FROM hd_scheduled_jobs WHERE job_id=$1', [id]))
        .rows[0];
      if (old) return { jobId: id };
      await boss.send(queueNames[kind], data, { id, db: { executeSql: (q, v) => c.query(q, v) } });
      await c.query(
        'INSERT INTO hd_scheduled_jobs(job_id,school_id,kind,source_id,input_hash) VALUES($1,$2,$3,$4,$5)',
        [id, schoolId, kind, sourceKey, hash(canonical(data))],
      );
      return { jobId: id };
    },
    async inspect(c, kind, id) {
      if (!Object.hasOwn(queueNames, kind)) throw problem('queue_kind_unavailable', 409);
      return (
        (
          await boss.findJobs(queueNames[kind], {
            id,
            limit: 1,
            db: { executeSql: (q, v) => c.query(q, v) },
          })
        )[0] || null
      );
    },
    async retryFailed(c, kind, id) {
      if (!Object.hasOwn(queueNames, kind)) throw problem('queue_kind_unavailable', 409);
      const result = await boss.retry(queueNames[kind], id, {
        db: { executeSql: (q, v) => c.query(q, v) },
      });
      if (result.affected !== 1) throw problem('queue_job_state_changed', 409);
      return { jobId: id, accepted: true };
    },
    async scheduleReminder(c, { schoolId, reminderId, dueAt }) {
      fields({ schoolId, reminderId, dueAt }, ['schoolId', 'reminderId', 'dueAt'], 'reminder');
      if (
        !validId(schoolId) ||
        !validId(reminderId) ||
        !Number.isFinite(Date.parse(dueAt)) ||
        !config.schools.some((s) => s.schoolId === schoolId)
      )
        throw problem('reminder_invalid');
      const id = jobId(`${schoolId}:activity-reminder:${reminderId}`);
      const fingerprint = hash(
        canonical({ schoolId, reminderId, dueAt: new Date(dueAt).toISOString() }),
      );
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id]);
      const old = (await c.query('SELECT input_hash FROM hd_scheduled_jobs WHERE job_id=$1', [id]))
        .rows[0];
      if (old) {
        if (old.input_hash !== fingerprint) throw problem('scheduled_job_conflict', 409);
        return { jobId: id };
      }
      await boss.send(
        queueNames['activity-reminder'],
        { kind: 'activity-reminder', schoolId, reminderId },
        { id, startAfter: new Date(dueAt), db: { executeSql: (q, v) => c.query(q, v) } },
      );
      await c.query(
        'INSERT INTO hd_scheduled_jobs(job_id,school_id,kind,source_id,input_hash) VALUES($1,$2,$3,$4,$5)',
        [id, schoolId, 'activity-reminder', reminderId, fingerprint],
      );
      return { jobId: id };
    },
    async list() {
      const queues = await boss.getQueues();
      return {
        queues: queues
          .filter((q) => Object.values(queueNames).includes(q.name))
          .map((q) => ({ name: q.name, retryLimit: q.retryLimit })),
      };
    },
    close: () => boss.stop({ graceful: true, timeout: 10000 }),
  };
}
