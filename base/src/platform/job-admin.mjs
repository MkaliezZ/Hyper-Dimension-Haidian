import { problem } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { fields } from '../protocol/index.mjs';
import { contactReceipt } from './contacts.mjs';
import { createModulePolicy } from './modules.mjs';
const uuid = (x) =>
  typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
export function createJobAdmin(db, identity, services, jobs, config) {
  const modules = createModulePolicy(config);
  async function locked(c, school, user) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      school + ':permissions',
    ]);
    await scope(db, school, user, null, 'manage', c);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [school + ':job-admin']);
  }
  async function scheduled(c, school, id) {
    if (!uuid(id)) throw problem('queue_job_id_invalid');
    const r = (
      await c.query('SELECT * FROM hd_scheduled_jobs WHERE school_id=$1 AND job_id=$2', [
        school,
        id,
      ])
    ).rows[0];
    if (!r) throw problem('queue_job_missing', 404);
    return r;
  }
  async function inspect(c, school, r) {
    const job = await jobs.inspect(c, r.kind, r.job_id);
    const source =
      r.kind === 'activity-reminder'
        ? (
            await c.query(
              'SELECT status FROM hd_activity_reminders WHERE school_id=$1 AND reminder_id=$2',
              [school, r.source_id],
            )
          ).rows[0]
        : ['forum-index', 'knowledge-index'].includes(r.kind)
          ? (
              await c.query(
                "SELECT CASE WHEN complete THEN 'indexed' ELSE 'pending' END AS status FROM hd_index_sources WHERE school_id=$1 AND kind=$2 AND job_id=$3",
                [school, r.kind, r.job_id],
              )
            ).rows[0]
          : null;
    const matches = Boolean(
      job &&
      job.data &&
      job.data.schoolId === school &&
      job.data.kind === r.kind &&
      (r.kind === 'activity-reminder'
        ? job.data.reminderId === r.source_id &&
          Object.keys(job.data).sort().join(',') === 'kind,reminderId,schoolId'
        : r.source_id === job.data.sourceId + ':' + job.data.generation + ':' + job.data.cursor &&
          Object.keys(job.data).sort().join(',') === 'cursor,generation,kind,schoolId,sourceId'),
    );
    return { job, source, matches };
  }
  async function view(c, school, r) {
    const { job, source, matches } = await inspect(c, school, r);
    return {
      jobId: r.job_id,
      kind: r.kind,
      state: job?.state || 'not_retained',
      retryCount: job?.retryCount ?? null,
      retryLimit: job?.retryLimit ?? null,
      createdAt: r.created_at,
      startAfter: job?.startAfter || null,
      startedAt: job?.startedOn || null,
      completedAt: job?.completedOn || null,
      sourceState: source?.status || 'missing',
      canRetry:
        (r.kind === 'knowledge-index' || modules.forSchool(school).base3) &&
        job?.state === 'failed' &&
        matches &&
        Boolean(source),
      diagnostic: !job
        ? 'queue_record_not_retained'
        : !matches
          ? 'queue_source_mismatch'
          : !source
            ? 'business_source_missing'
            : job.state === 'failed'
              ? 'business_job_failed'
              : null,
    };
  }
  return {
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'jobs') return false;
      if (p[1] !== 'schools' || p[3] !== 'items' || !p[2])
        throw problem('queue_route_missing', 404);
      const school = services.school(p[2]).schoolId,
        user = (await identity.user(req)).user_id;
      await scope(db, school, user, null, 'manage');
      if (req.method === 'GET' && p.length === 5) {
        const result = await db.tx(async (c) => {
          await locked(c, school, user);
          return view(c, school, await scheduled(c, school, p[4]));
        });
        json(res, 200, result);
        return true;
      }
      if (req.method === 'GET' && p.length === 4) {
        const result = await db.tx(async (c) => {
          await locked(c, school, user);
          const after = url.searchParams.get('after'),
            anchor = after ? await scheduled(c, school, after) : null;
          const rows = (
            await c.query(
              'SELECT * FROM hd_scheduled_jobs WHERE school_id=$1 ' +
                (anchor ? 'AND (created_at,job_id)<($2,$3) ' : '') +
                'ORDER BY created_at DESC,job_id DESC LIMIT 51',
              anchor ? [school, anchor.created_at, anchor.job_id] : [school],
            )
          ).rows;
          const items = [];
          for (const r of rows.slice(0, 50)) items.push(await view(c, school, r));
          return {
            schoolId: school,
            retryEnabled: modules.forSchool(school).base3,
            items,
            next: rows.length > 50 ? rows[49].job_id : null,
          };
        });
        json(res, 200, result);
        return true;
      }
      if (req.method === 'POST' && p.length === 6 && p[5] === 'retry') {
        const b = fields(
          await body(req),
          ['requestId', 'expectedRetryCount', 'reason'],
          'queue_retry',
        );
        if (
          !Number.isSafeInteger(b.expectedRetryCount) ||
          b.expectedRetryCount < 0 ||
          typeof b.reason !== 'string' ||
          b.reason.trim().length < 3 ||
          b.reason.length > 1000
        )
          throw problem('queue_retry_input_invalid');
        const result = await db.tx(async (c) => {
          await locked(c, school, user);
          const r = await scheduled(c, school, p[4]);
          if (r.kind !== 'knowledge-index' && !modules.forSchool(school).base3)
            throw problem('module_disabled', 409);
          return contactReceipt(c, school, user, url.pathname, b, async () => {
            const { job, source, matches } = await inspect(c, school, r);
            if (!job || !matches || !source) throw problem('queue_source_unavailable', 409);
            if (job.state !== 'failed' || job.retryCount !== b.expectedRetryCount)
              throw problem('queue_job_state_changed', 409);
            const receipt = await jobs.retryFailed(c, r.kind, r.job_id);
            await audit(c, school, user, 'jobs.retry', r.job_id, {
              kind: r.kind,
              previousRetryCount: job.retryCount,
              reason: b.reason.trim(),
            });
            return { ...receipt, previousRetryCount: job.retryCount };
          });
        });
        json(res, 200, result);
        return true;
      }
      throw problem('queue_route_missing', 404);
    },
  };
}
