import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hash, problem } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { canonical, fields } from '../protocol/index.mjs';
import {
  validateAnnualDocument,
  annualDiff,
  annualNumber,
  annualKey,
  annualText,
  annualDate,
  annualUrl,
  annualPriority,
  annualPeriod,
} from './annual-contract.mjs';
const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const fp = (v) => hash(canonical(v));
const cas = (row, revision) => {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision !== (row?.revision || 0))
    throw problem('revision_conflict', 409);
};
export function createAnnual(db, identity, services, { createActivityDraft, modulePolicy }) {
  const lock = async (c, s, write = false) => {
    await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
      s + ':permissions',
    ]);
    await c.query(
      'SELECT pg_advisory_xact_lock' + (write ? '' : '_shared') + '(hashtextextended($1,0))',
      [s + ':annual'],
    );
  };
  const auth = async (c, s, u, org, manage = false, write = false) => {
    await lock(c, s, write);
    return scope(db, s, u, org, manage ? 'manage' : 'read', c);
  };
  const head = async (c, s, o, id) =>
    (
      await c.query(
        'SELECT * FROM hd_annual_heads WHERE school_id=$1 AND scope_id=$2 AND package_id=$3',
        [s, o || '', annualKey(id)],
      )
    ).rows[0] || null;
  const latest = async (c, s, o, id) =>
    (
      await c.query(
        'SELECT * FROM hd_annual_packages WHERE school_id=$1 AND scope_id=$2 AND package_id=$3 ORDER BY version DESC LIMIT 1',
        [s, o || '', annualKey(id)],
      )
    ).rows[0] || null;
  const document = async (c, s, o, id, v) => {
    const row = (
      await c.query(
        'SELECT * FROM hd_annual_packages WHERE school_id=$1 AND scope_id=$2 AND package_id=$3 AND version=$4',
        [s, o || '', annualKey(id), annualNumber(v, 1, 100000)],
      )
    ).rows[0];
    if (!row) throw problem('annual_package_missing', 404);
    return row;
  };
  const active = async (c, s, o, id) => {
    const h = await head(c, s, o, id);
    if (!h) throw problem('annual_active_package_required', 409);
    return { head: h, row: await document(c, s, o, id, h.active_version) };
  };
  async function preview(c, s, o, input) {
    const doc = validateAnnualDocument(input),
      old = await latest(c, s, o, doc.packageId);
    if (doc.version !== (old?.version || 0) + 1) throw problem('annual_version_conflict', 409);
    return {
      document: doc,
      documentHash: fp(doc),
      previousVersion: old?.version || 0,
      diff: annualDiff(old?.document, doc),
      effects: { publishesContent: 0, createsActivities: 0, issuesRewards: 0, contactsFamilies: 0 },
    };
  }
  async function manager(c, s, o, user) {
    if (!uuid(user)) throw problem('annual_owner_invalid');
    await scope(db, s, user, o, 'manage', c);
  }
  async function plan(c, s, o, b) {
    fields(b, ['packageId', 'academicYear', 'entryIds', 'ownerId'], 'annual_plan');
    annualNumber(b.academicYear, 2000, 2199);
    await manager(c, s, o, b.ownerId);
    if (
      !Array.isArray(b.entryIds) ||
      !b.entryIds.length ||
      b.entryIds.length > 100 ||
      new Set(b.entryIds).size !== b.entryIds.length
    )
      throw problem('annual_selection_invalid');
    const a = await active(c, s, o, b.packageId),
      rows = b.entryIds.map((id) => {
        const entry = a.row.document.entries.find((x) => x.entryId === id);
        if (!entry) throw problem('annual_entry_unknown');
        return {
          entry,
          period: annualPeriod(b.academicYear, a.row.document.startMonth, entry.month),
        };
      });
    const old = (
      await c.query(
        'SELECT entry_id FROM hd_annual_tasks WHERE school_id=$1 AND scope_id=$2 AND package_id=$3 AND academic_year=$4 AND entry_id=ANY($5)',
        [s, o || '', b.packageId, b.academicYear, b.entryIds],
      )
    ).rows;
    if (old.length) throw problem('annual_tasks_already_planned', 409);
    const value = {
      ...b,
      packageVersion: a.row.version,
      headRevision: a.head.revision,
      fingerprint: a.row.fingerprint,
      entries: rows,
    };
    return {
      ...value,
      previewHash: fp(value),
      effects: {
        createsPlanningTasks: rows.length,
        createsActivities: 0,
        publishesContent: 0,
        issuesRewards: 0,
      },
    };
  }
  async function task(c, s, o, id) {
    if (!uuid(id)) throw problem('annual_task_invalid');
    const row = (
      await c.query(
        'SELECT * FROM hd_annual_tasks WHERE school_id=$1 AND scope_id=$2 AND task_id=$3',
        [s, o || '', id],
      )
    ).rows[0];
    if (!row) throw problem('annual_task_missing', 404);
    return row;
  }
  return {
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'annual') return false;
      if (p[1] !== 'schools' || !p[2] || !['GET', 'POST'].includes(req.method))
        throw problem('annual_route_missing', 404);
      const s = services.school(p[2]).schoolId,
        u = (await identity.user(req)).user_id,
        o = p[3] === 'organizations' && p[4] ? p[4] : null,
        pos = o ? 5 : 3,
        action = p[pos],
        id = p[pos + 1],
        sub = p[pos + 2];
      if (!modulePolicy.forSchool(s).base3) throw problem('module_disabled', 409);
      if (url.searchParams.has('userId')) throw problem('own_planning_only', 403);
      const send = (x) => {
        json(res, 200, x);
        return true;
      };
      const own = ['mine'].includes(action);
      const read = (fn) =>
        db.tx(async (c) => {
          await auth(c, s, u, o, !own && ['tasks', 'versions'].includes(action));
          return send(await fn(c));
        });
      if (req.method === 'GET')
        return read(async (c) => {
          if (action === 'contexts' && !o) {
            const m = await db.member(s, u, null, c);
            const organizations = (
              await c.query(
                `SELECT o.org_id,o.name,($3='owner' OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=o.school_id AND g.org_id=o.org_id AND g.user_id=$2 AND g.active AND g.role='owner')) AS can_manage
       FROM hd_organizations o WHERE o.school_id=$1 AND o.active AND ($3='owner' OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=o.school_id AND g.org_id=o.org_id AND g.user_id=$2 AND g.active)) ORDER BY o.org_id`,
                [s, u, m.role],
              )
            ).rows;
            return {
              schoolAccessible: !['partner', 'affiliate'].includes(m.role),
              schoolManage: m.role === 'owner',
              organizations,
            };
          }
          if (action === 'example')
            return validateAnnualDocument(
              JSON.parse(
                await readFile(
                  new URL('../../examples/operations/annual-starter-v1.json', import.meta.url),
                  'utf8',
                ),
              ),
            );
          if (action === 'packages') {
            let manage = false;
            try {
              await scope(db, s, u, o, 'manage', c);
              manage = true;
            } catch (e) {
              if (e.status !== 403) throw e;
            }
            const rows = (
              await c.query(
                `SELECT a.package_id,a.version,a.fingerprint,a.document->>'name' AS name,a.document->>'sourceLabel' AS source_label,h.active_version,h.revision AS head_revision
      FROM hd_annual_packages a LEFT JOIN hd_annual_heads h USING(school_id,scope_id,package_id)
      WHERE a.school_id=$1 AND a.scope_id=$2 AND ($3 OR a.version=h.active_version) ORDER BY a.package_id,a.version DESC`,
                [s, o || '', manage],
              )
            ).rows;
            return { packages: rows, canManage: manage };
          }
          if (action === 'versions' && id)
            return document(c, s, o, id, Number(url.searchParams.get('version')));
          if (action === 'catalog') {
            const a = await active(c, s, o, url.searchParams.get('packageId')),
              cohort = url.searchParams.get('cohort'),
              month = url.searchParams.get('month'),
              channel = url.searchParams.get('channel'),
              category = url.searchParams.get('category');
            if (cohort && !a.row.document.cohorts.some((x) => x.id === cohort))
              throw problem('annual_cohort_unknown');
            if (month) annualNumber(Number(month), 1, 12);
            const entries = a.row.document.entries.filter(
              (x) =>
                (!cohort || x.cohortIds.includes(cohort)) &&
                (!month || x.month === Number(month)) &&
                (!channel || x.channel === channel) &&
                (!category || x.category === category),
            );
            return {
              ...a.row.document,
              entries,
              headRevision: a.head.revision,
              originalEntryCount: a.row.document.entries.length,
            };
          }
          if (action === 'tasks')
            return {
              tasks: (
                await c.query(
                  'SELECT * FROM hd_annual_tasks WHERE school_id=$1 AND scope_id=$2 AND ($3::text IS NULL OR package_id=$3) AND ($4::integer IS NULL OR academic_year=$4) ORDER BY period,created_at LIMIT 2000',
                  [
                    s,
                    o || '',
                    url.searchParams.get('packageId')
                      ? annualKey(url.searchParams.get('packageId'))
                      : null,
                    url.searchParams.has('academicYear')
                      ? annualNumber(Number(url.searchParams.get('academicYear')), 2000, 2199)
                      : null,
                  ],
                )
              ).rows,
            };
          if (action === 'mine')
            return {
              items: (
                await c.query(
                  'SELECT * FROM hd_annual_personal WHERE school_id=$1 AND scope_id=$2 AND user_id=$3 AND ($4::text IS NULL OR package_id=$4) AND ($5::integer IS NULL OR academic_year=$5) ORDER BY updated_at DESC LIMIT 1000',
                  [
                    s,
                    o || '',
                    u,
                    url.searchParams.get('packageId')
                      ? annualKey(url.searchParams.get('packageId'))
                      : null,
                    url.searchParams.has('academicYear')
                      ? annualNumber(Number(url.searchParams.get('academicYear')), 2000, 2199)
                      : null,
                  ],
                )
              ).rows,
              private: true,
              contributionScore: false,
            };
          throw problem('annual_route_missing', 404);
        });
      const b = await body(req);
      if (action === 'preview')
        return db.tx(async (c) => {
          await auth(c, s, u, o, true);
          fields(b, ['document'], 'annual_preview');
          return send(await preview(c, s, o, b.document));
        });
      if (action === 'tasks' && id === 'preview')
        return db.tx(async (c) => {
          await auth(c, s, u, o, true);
          return send(await plan(c, s, o, b));
        });
      const mutate = (fn) =>
        db.receipt(s, u, b.requestId, { module: 'annual', path: url.pathname, input: b }, fn, (c) =>
          auth(c, s, u, o, !own, true),
        );
      if (action === 'import') {
        fields(
          b,
          ['requestId', 'document', 'previewHash', 'expectedLatestVersion', 'confirmed', 'reason'],
          'annual_import',
        );
        return send(
          await mutate(async (c) => {
            const v = await preview(c, s, o, b.document);
            annualText(b.reason, 3, 500);
            if (
              b.confirmed !== true ||
              v.documentHash !== b.previewHash ||
              b.expectedLatestVersion !== v.previousVersion
            )
              throw problem('annual_preview_confirmation_required', 409);
            await c.query(
              'INSERT INTO hd_annual_packages(school_id,scope_id,package_id,version,document,fingerprint,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                s,
                o || '',
                v.document.packageId,
                v.document.version,
                v.document,
                v.documentHash,
                u,
                b.reason,
              ],
            );
            await audit(c, s, u, 'annual_import', v.document.packageId, {
              version: v.document.version,
              fingerprint: v.documentHash,
            });
            return { packageId: v.document.packageId, version: v.document.version };
          }),
        );
      }
      if (action === 'activate') {
        fields(
          b,
          ['requestId', 'packageId', 'version', 'expectedRevision', 'confirmed', 'reason'],
          'annual_activate',
        );
        return send(
          await mutate(async (c) => {
            const d = await document(c, s, o, b.packageId, b.version),
              h = await head(c, s, o, b.packageId);
            cas(h, b.expectedRevision);
            annualText(b.reason, 3, 500);
            if (b.confirmed !== true) throw problem('annual_confirmation_required');
            await c.query(
              'INSERT INTO hd_annual_heads VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(school_id,scope_id,package_id) DO UPDATE SET active_version=$4,revision=$5,actor_id=$6,updated_at=now()',
              [s, o || '', d.package_id, d.version, (h?.revision || 0) + 1, u],
            );
            await audit(c, s, u, 'annual_activate', d.package_id, {
              version: d.version,
              reason: b.reason,
            });
            return { version: d.version, revision: (h?.revision || 0) + 1 };
          }),
        );
      }
      if (action === 'tasks' && !id) {
        fields(b, ['requestId', 'plan', 'previewHash', 'confirmed'], 'annual_plan_commit');
        return send(
          await mutate(async (c) => {
            const v = await plan(c, s, o, b.plan);
            if (b.confirmed !== true || b.previewHash !== v.previewHash)
              throw problem('annual_preview_confirmation_required', 409);
            const tasks = [];
            for (const x of v.entries) {
              const taskId = randomUUID();
              await c.query(
                'INSERT INTO hd_annual_tasks(school_id,task_id,scope_id,package_id,package_version,academic_year,entry_id,snapshot,period,owner_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
                [
                  s,
                  taskId,
                  o || '',
                  v.packageId,
                  v.packageVersion,
                  v.academicYear,
                  x.entry.entryId,
                  x.entry,
                  x.period,
                  v.ownerId,
                  u,
                ],
              );
              tasks.push({ taskId, entryId: x.entry.entryId, period: x.period, status: 'planned' });
            }
            await audit(c, s, u, 'annual_plan', v.packageId, {
              academicYear: v.academicYear,
              version: v.packageVersion,
              count: tasks.length,
            });
            return { tasks, createsActivities: 0, issuesRewards: 0 };
          }),
        );
      }
      if (action === 'tasks' && id) {
        if (sub === 'activity') {
          fields(b, ['requestId', 'expectedRevision', 'confirmed', 'input'], 'annual_activity');
          return send(
            await mutate(async (c) => {
              const t = await task(c, s, o, id);
              cas(t, b.expectedRevision);
              const a = await active(c, s, o, t.package_id);
              if (
                t.status !== 'planned' ||
                t.snapshot.channel !== 'event' ||
                t.activity_id ||
                a.row.version !== t.package_version
              )
                throw problem('annual_activity_review_required', 409);
              if (b.confirmed !== true || !t.date_verified || !t.due_at)
                throw problem('annual_verified_date_required', 409);
              fields(
                b.input,
                [
                  'kind',
                  'startsAt',
                  'endsAt',
                  'registrationClosesAt',
                  'capacity',
                  'remindBeforeMinutes',
                  'verifierIds',
                  'sceneId',
                  'entityId',
                  'tasks',
                ],
                'annual_activity_input',
              );
              const startsAt = annualDate(b.input.startsAt);
              if (startsAt !== new Date(t.due_at).toISOString())
                throw problem('annual_verified_date_mismatch', 409);
              const activity = await createActivityDraft(c, {
                schoolId: s,
                userId: u,
                input: {
                  ...b.input,
                  orgId: o,
                  title: t.snapshot.title,
                  description: t.snapshot.description || t.snapshot.title,
                  conditions: t.snapshot.applicability || '请核对本校实际安排后自愿参与。',
                },
              });
              await c.query(
                'UPDATE hd_annual_tasks SET activity_id=$3,revision=revision+1,updated_at=now() WHERE school_id=$1 AND task_id=$2',
                [s, id, activity.activityId],
              );
              await audit(c, s, u, 'annual_activity_draft', id, {
                activityId: activity.activityId,
              });
              return { activityId: activity.activityId, status: 'draft', revision: t.revision + 1 };
            }),
          );
        }
        if (sub) throw problem('annual_route_missing', 404);
        fields(
          b,
          [
            'requestId',
            'expectedRevision',
            'ownerId',
            'status',
            'dueAt',
            'dateVerified',
            'officialUrl',
            'reason',
            'refreshSource',
          ],
          'annual_task_update',
        );
        return send(
          await mutate(async (c) => {
            const t = await task(c, s, o, id);
            cas(t, b.expectedRevision);
            await manager(c, s, o, b.ownerId);
            annualText(b.reason, 3, 500);
            if (
              !['planned', 'done', 'cancelled'].includes(b.status) ||
              typeof b.dateVerified !== 'boolean'
            )
              throw problem('annual_task_update_invalid');
            const due = annualDate(b.dueAt),
              official = annualUrl(b.officialUrl);
            if (b.dateVerified && !due) throw problem('annual_verified_date_required');
            if (b.refreshSource !== undefined && typeof b.refreshSource !== 'boolean')
              throw problem('annual_task_update_invalid');
            let source = t.snapshot,
              version = t.package_version;
            if (b.refreshSource) {
              const a = await active(c, s, o, t.package_id);
              source = a.row.document.entries.find((e) => e.entryId === t.entry_id);
              if (!source) throw problem('annual_entry_unknown');
              version = a.row.version;
            }
            const history = [
              ...t.history,
              {
                revision: t.revision,
                ownerId: t.owner_id,
                status: t.status,
                dueAt: t.due_at,
                packageVersion: t.package_version,
                snapshot: t.snapshot,
                reason: b.reason,
                actor: u,
                at: new Date().toISOString(),
              },
            ];
            await c.query(
              'UPDATE hd_annual_tasks SET owner_id=$3,status=$4,due_at=$5,date_verified=$6,official_url=$7,history=$8,package_version=$9,snapshot=$10,revision=revision+1,updated_at=now() WHERE school_id=$1 AND task_id=$2',
              [
                s,
                id,
                b.ownerId,
                b.status,
                due,
                b.dateVerified,
                official,
                JSON.stringify(history),
                version,
                source,
              ],
            );
            await audit(c, s, u, 'annual_task_update', id, {
              revision: t.revision + 1,
              reason: b.reason,
            });
            return { taskId: id, revision: t.revision + 1 };
          }),
        );
      }
      if (action === 'mine') {
        if (id === 'remove') {
          fields(
            b,
            ['requestId', 'packageId', 'academicYear', 'chainId', 'expectedRevision', 'confirmed'],
            'annual_personal_remove',
          );
          return send(
            await mutate(async (c) => {
              annualKey(b.packageId);
              annualKey(b.chainId);
              annualNumber(b.academicYear, 2000, 2199);
              if (b.confirmed !== true) throw problem('annual_confirmation_required');
              const r = (
                await c.query(
                  'SELECT revision FROM hd_annual_personal WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND package_id=$4 AND academic_year=$5 AND chain_id=$6',
                  [s, u, o || '', b.packageId, b.academicYear, b.chainId],
                )
              ).rows[0];
              if (!r) throw problem('annual_personal_missing', 404);
              cas(r, b.expectedRevision);
              await c.query(
                'DELETE FROM hd_annual_personal WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND package_id=$4 AND academic_year=$5 AND chain_id=$6',
                [s, u, o || '', b.packageId, b.academicYear, b.chainId],
              );
              return { removed: true };
            }),
          );
        }
        if (id) throw problem('annual_route_missing', 404);
        fields(
          b,
          [
            'requestId',
            'packageId',
            'academicYear',
            'entryId',
            'expectedRevision',
            'confirmed',
            'status',
            'priority',
            'dueAt',
          ],
          'annual_personal',
        );
        return send(
          await mutate(async (c) => {
            annualNumber(b.academicYear, 2000, 2199);
            if (b.confirmed !== true || !['active', 'done', 'not-applicable'].includes(b.status))
              throw problem('annual_personal_confirmation_required');
            const a = await active(c, s, o, b.packageId);
            let e = a.row.document.entries.find((x) => x.entryId === b.entryId);
            if (!e && b.status !== 'active') {
              const previous = (
                await c.query(
                  'SELECT snapshot FROM hd_annual_personal WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND package_id=$4 AND academic_year=$5 AND entry_id=$6',
                  [s, u, o || '', b.packageId, b.academicYear, b.entryId],
                )
              ).rows[0];
              e = previous?.snapshot;
            }
            if (!e) throw problem('annual_entry_unknown');
            const r = (
              await c.query(
                'SELECT revision FROM hd_annual_personal WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND package_id=$4 AND academic_year=$5 AND chain_id=$6',
                [s, u, o || '', b.packageId, b.academicYear, e.chainId],
              )
            ).rows[0];
            cas(r, b.expectedRevision);
            const priority = annualPriority(e.category, b.priority, b.status),
              due = annualDate(b.dueAt),
              revision = (r?.revision || 0) + 1;
            await c.query(
              'INSERT INTO hd_annual_personal VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) ON CONFLICT(school_id,user_id,scope_id,package_id,academic_year,chain_id) DO UPDATE SET entry_id=$7,snapshot=$8,status=$9,priority=$10,due_at=$11,revision=$12,updated_at=now()',
              [
                s,
                u,
                o || '',
                b.packageId,
                b.academicYear,
                e.chainId,
                e.entryId,
                e,
                b.status,
                priority,
                due,
                revision,
              ],
            );
            return { saved: true, revision, chainId: e.chainId };
          }),
        );
      }
      throw problem('annual_route_missing', 404);
    },
  };
}
