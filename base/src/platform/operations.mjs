import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hash, problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { canonical, fields } from '../protocol/index.mjs';

const txt = (v, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max)
    throw problem('operations_text_invalid');
  return v.trim();
};
const integer = (v, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw problem('operations_number_invalid');
  return v;
};
const key = (v) => {
  if (!validId(v)) throw problem('operations_id_invalid');
  return v;
};
const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const fingerprint = (v) => hash(canonical(v));
const schema = 'hyper-dimension.operations/v1';
const templateKeys = [
  'templateId',
  'kind',
  'title',
  'description',
  'conditions',
  'tasks',
  'dayOffset',
  'durationMinutes',
  'registrationMinutesBefore',
  'capacity',
  'remindBeforeMinutes',
  'responsibility',
];
export function validateOperationsPackage(value) {
  const d = fields(
    value,
    [
      'schema',
      'packageId',
      'version',
      'name',
      'description',
      'sourceLabel',
      'exampleOnly',
      'templates',
    ],
    'operations_package',
  );
  if (d.schema !== schema || typeof d.exampleOnly !== 'boolean')
    throw problem('operations_schema_invalid');
  key(d.packageId);
  integer(d.version, 1, 100000);
  txt(d.name, 2, 160);
  txt(d.description, 5, 2000);
  txt(d.sourceLabel, 3, 300);
  if (!Array.isArray(d.templates) || d.templates.length < 1 || d.templates.length > 12)
    throw problem('operations_templates_invalid');
  const seen = new Set();
  for (const t of d.templates) {
    fields(t, templateKeys, 'operations_template');
    key(t.templateId);
    if (seen.has(t.templateId)) throw problem('operations_template_duplicate');
    seen.add(t.templateId);
    if (!['event', 'volunteer'].includes(t.kind)) throw problem('operations_kind_invalid');
    txt(t.title, 2, 160);
    txt(t.description, 5, 5000);
    txt(t.conditions, 2, 2000);
    txt(t.responsibility, 2, 300);
    integer(t.dayOffset, 0, 366);
    integer(t.durationMinutes, 15, 10080);
    integer(t.registrationMinutesBefore, 0, 10080);
    integer(t.capacity, 1, 100000);
    integer(t.remindBeforeMinutes, 0, 10080);
    if (
      !Array.isArray(t.tasks) ||
      t.tasks.length > 30 ||
      (t.kind === 'volunteer' && !t.tasks.length)
    )
      throw problem('operations_tasks_invalid');
    const tasks = new Set();
    for (const task of t.tasks) {
      fields(task, ['id', 'title', 'description'], 'operations_task');
      key(task.id);
      if (tasks.has(task.id)) throw problem('operations_task_duplicate');
      tasks.add(task.id);
      txt(task.title, 2, 100);
      txt(task.description, 2, 1000);
    }
  }
  return JSON.parse(canonical(d));
}
export function operationsDiff(old, next) {
  const before = new Map((old?.templates || []).map((t) => [t.templateId, t])),
    after = new Map(next.templates.map((t) => [t.templateId, t]));
  return {
    metadata: ['name', 'description', 'sourceLabel', 'exampleOnly'].filter(
      (k) => canonical(old?.[k] ?? null) !== canonical(next[k]),
    ),
    added: [...after.keys()].filter((k) => !before.has(k)),
    removed: [...before.keys()].filter((k) => !after.has(k)),
    changed: [...after.keys()]
      .filter((k) => before.has(k))
      .map((k) => ({
        templateId: k,
        fields: templateKeys.filter(
          (f) => canonical(before.get(k)[f]) !== canonical(after.get(k)[f]),
        ),
      }))
      .filter((x) => x.fields.length),
  };
}
const planFields = [
  'packageId',
  'packageVersion',
  'expectedHeadRevision',
  'title',
  'startsAt',
  'responsibleId',
  'verifierIds',
  'sceneId',
  'entityId',
  'ruleVersion',
  'rewardId',
  'templateIds',
];

export function createOperations(
  db,
  identity,
  services,
  config,
  { createActivityDraft, validateReward } = {},
) {
  const lock = async (c, s) => {
    for (const name of ['permissions', 'operations'])
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [s + ':' + name]);
  };
  const authorize = async (c, s, u, org) => {
    await lock(c, s);
    await scope(db, s, u, org, 'manage', c);
  };
  const docRow = async (c, s, org, id, version) => {
    key(id);
    integer(version, 1, 100000);
    const row = (
      await c.query(
        'SELECT * FROM hd_operation_packages WHERE school_id=$1 AND scope_id=$2 AND package_id=$3 AND version=$4',
        [s, org || '', id, version],
      )
    ).rows[0];
    if (!row) throw problem('operations_package_missing', 404);
    return row;
  };
  const head = async (c, s, org, id) =>
    (
      await c.query(
        'SELECT * FROM hd_operation_heads WHERE school_id=$1 AND scope_id=$2 AND package_id=$3',
        [s, org || '', id],
      )
    ).rows[0] || null;
  const latest = async (c, s, org, id) =>
    (
      await c.query(
        'SELECT * FROM hd_operation_packages WHERE school_id=$1 AND scope_id=$2 AND package_id=$3 ORDER BY version DESC LIMIT 1',
        [s, org || '', id],
      )
    ).rows[0] || null;
  async function preview(c, s, org, input) {
    const document = validateOperationsPackage(input),
      old = await latest(c, s, org, document.packageId);
    if (document.version !== (old?.version || 0) + 1)
      throw problem('operations_next_version_required', 409);
    return {
      document,
      documentHash: fingerprint(document),
      previousVersion: old?.version || 0,
      previousHash: old?.fingerprint || null,
      diff: operationsDiff(old?.document, document),
      effects: { createsActivities: 0, activatesRules: 0, issuesRewards: 0, changesHistory: false },
      warning: document.exampleOnly ? '虚构示例，不代表本校已确认运营规则。' : null,
    };
  }
  async function runPlan(c, s, u, org, b) {
    fields(b, planFields, 'operations_plan');
    key(b.packageId);
    integer(b.packageVersion, 1, 100000);
    integer(b.expectedHeadRevision, 1, 100000);
    txt(b.title, 2, 160);
    if (
      !uuid(b.responsibleId) ||
      !Array.isArray(b.verifierIds) ||
      !b.verifierIds.length ||
      b.verifierIds.length > 20 ||
      !b.verifierIds.every(uuid) ||
      new Set(b.verifierIds).size !== b.verifierIds.length
    )
      throw problem('operations_people_invalid');
    await scope(db, s, b.responsibleId, org, 'manage', c);
    for (const verifier of b.verifierIds) await scope(db, s, verifier, org, 'read', c);
    const d = await docRow(c, s, org, b.packageId, b.packageVersion),
      h = await head(c, s, org, b.packageId);
    if (!h || h.revision !== b.expectedHeadRevision || h.active_version !== b.packageVersion)
      throw problem('operations_active_version_conflict', 409);
    const start = Date.parse(b.startsAt);
    if (typeof b.startsAt !== 'string' || !Number.isFinite(start))
      throw problem('operations_date_invalid');
    if (
      !Array.isArray(b.templateIds) ||
      !b.templateIds.length ||
      new Set(b.templateIds).size !== b.templateIds.length ||
      !b.templateIds.every((id) => d.document.templates.some((t) => t.templateId === id))
    )
      throw problem('operations_selection_invalid');
    if (
      ((b.sceneId || null) !== null && typeof b.sceneId !== 'string') ||
      ((b.entityId || null) !== null && typeof b.entityId !== 'string')
    )
      throw problem('operations_place_invalid');
    let rule = null,
      reward = null;
    if (b.ruleVersion) {
      key(b.ruleVersion);
      rule = (
        await c.query(
          "SELECT rule_version,fingerprint,document,status FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2 AND status='approved'",
          [s, b.ruleVersion],
        )
      ).rows[0];
      if (!rule) throw problem('operations_approved_rule_required', 409);
    }
    if (b.rewardId) {
      if (!validateReward) throw problem('operations_rewards_unavailable', 503);
      reward = await validateReward(c, {
        schoolId: s,
        userId: u,
        orgId: org,
        rewardId: b.rewardId,
      });
    }
    const slots = [];
    for (const t of d.document.templates.filter((t) => b.templateIds.includes(t.templateId))) {
      const begins = start + t.dayOffset * 86400000,
        ends = begins + t.durationMinutes * 60000;
      if (ends <= Date.now()) throw problem('operations_future_schedule_required');
      const periods = (
        await c.query(
          "SELECT period,rule_version,starts_at,ends_at,activated_at FROM hd_campus_periods WHERE school_id=$1 AND scope_id=$2 AND status='active' AND starts_at<$3 AND ends_at>$4 ORDER BY starts_at,period",
          [s, org || '', new Date(ends), new Date(begins)],
        )
      ).rows;
      if (rule && periods.some((p) => p.rule_version !== rule.rule_version))
        throw problem('operations_active_rule_conflict', 409);
      slots.push({
        templateId: t.templateId,
        responsibility: t.responsibility,
        input: {
          kind: t.kind,
          orgId: org,
          title: t.title,
          description: t.description,
          conditions: t.conditions,
          tasks: t.tasks,
          sceneId: b.sceneId || null,
          entityId: b.entityId || null,
          startsAt: new Date(begins).toISOString(),
          endsAt: new Date(ends).toISOString(),
          registrationClosesAt: new Date(
            begins - t.registrationMinutesBefore * 60000,
          ).toISOString(),
          capacity: t.capacity,
          remindBeforeMinutes: t.remindBeforeMinutes,
          verifierIds: b.verifierIds,
        },
        periods,
      });
    }
    const data = {
      packageId: d.package_id,
      packageVersion: d.version,
      packageHash: d.fingerprint,
      headRevision: h.revision,
      title: b.title,
      responsibleId: b.responsibleId,
      exampleOnly: d.document.exampleOnly,
      slots,
      rule: rule
        ? {
            ruleVersion: rule.rule_version,
            fingerprint: rule.fingerprint,
            label: rule.document.label,
          }
        : null,
      reward,
      warnings: [
        ...(d.document.exampleOnly ? ['虚构模板：负责人需确认本校实际安排。'] : []),
        ...(!rule ? ['未绑定获准贡献规则；不承诺预计积分。'] : []),
        ...(slots.some((t) => !t.periods.length)
          ? ['部分活动日期尚无激活的计分时期。实际核验仍按事件时生效规则，不由排期发分。']
          : []),
        ...(reward ? ['奖励仅关联运营目标，领取/发放须另走奖励资格与库存校验。'] : []),
      ],
      effects: {
        createsDraftActivities: slots.length,
        publishesActivities: 0,
        activatesRules: 0,
        issuesRewards: 0,
        changesHistory: false,
      },
    };
    return { ...data, previewHash: fingerprint(data) };
  }
  const runRow = async (c, s, org, id) => {
    if (!uuid(id)) throw problem('operations_run_id_invalid');
    const r = (
      await c.query(
        'SELECT * FROM hd_operation_runs WHERE school_id=$1 AND run_id=$2 AND scope_id=$3',
        [s, id, org || ''],
      )
    ).rows[0];
    if (!r) throw problem('operations_run_missing', 404);
    return r;
  };
  async function report(c, s, org, r) {
    const timeline = [];
    for (const ref of r.activities) {
      const a = (
        await c.query(
          'SELECT activity_id,title,kind,status,revision,starts_at,ends_at,capacity,org_id,recap,recap_revision FROM hd_activities WHERE school_id=$1 AND activity_id=$2',
          [s, ref.activityId],
        )
      ).rows[0];
      if (!a || (a.org_id || '') !== (org || ''))
        throw problem('operations_activity_binding_invalid', 409);
      const participants = (
        await c.query(
          'SELECT status,count(*)::int AS count,coalesce(sum(verified_minutes),0)::int AS verified_minutes FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2 GROUP BY status',
          [s, a.activity_id],
        )
      ).rows;
      const contributions = (
        await c.query(
          'SELECT count(*)::int AS entries,coalesce(sum(c.delta),0)::int AS delta FROM hd_contributions c JOIN hd_activity_events e ON c.event_id=e.event_id WHERE e.school_id=$1 AND e.activity_id=$2',
          [s, a.activity_id],
        )
      ).rows[0];
      timeline.push({ ...ref, activity: a, participants, contributions });
    }
    const person = (
      await c.query('SELECT user_id,display_name FROM hd_users WHERE user_id=$1', [
        r.responsible_id,
      ])
    ).rows[0];
    let currentResponsibleAuthorized = true;
    try {
      await scope(db, s, r.responsible_id, org, 'manage', c);
    } catch (e) {
      if (e.status !== 403) throw e;
      currentResponsibleAuthorized = false;
    }
    return {
      schema: 'hyper-dimension.operations-review/v1',
      schoolId: s,
      orgId: org,
      runId: r.run_id,
      revision: r.revision,
      title: r.title,
      package: {
        packageId: r.package_id,
        version: r.package_version,
        fingerprint: r.package_fingerprint,
        exampleOnly: r.plan.exampleOnly,
      },
      responsible: person,
      currentResponsibleAuthorized,
      createdBy: r.created_by,
      createdAt: r.created_at,
      plan: r.plan,
      timeline,
      handoffs: r.handoffs,
      nextActions: timeline
        .filter((t) => ['draft', 'pending', 'rejected'].includes(t.activity.status))
        .map((t) => ({
          activityId: t.activityId,
          status: t.activity.status,
          url:
            '/activities.html?school=' +
            encodeURIComponent(s) +
            (org ? '&organization=' + encodeURIComponent(org) : '') +
            '&activity=' +
            encodeURIComponent(t.activityId),
        })),
      boundaries: [
        '模板排期只创建草稿；审核发布、核验与发奖各自受控。',
        '复盘只列当前活动汇总与实际贡献流水，不导出个人证据、联系方式或私信。',
        '旧版本和原活动不被新版模板或负责人交接改写。',
      ],
    };
  }
  return {
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'operations') return false;
      if (p[1] !== 'schools' || !p[2] || !['GET', 'POST'].includes(req.method))
        throw problem('operations_route_missing', 404);
      const s = services.school(p[2]).schoolId,
        u = (await identity.user(req)).user_id,
        org = p[3] === 'organizations' && p[4] ? p[4] : null,
        pos = org ? 5 : 3,
        action = p[pos],
        id = p[pos + 1],
        sub = p[pos + 2];
      const send = (x) => {
        json(res, 200, x);
        return true;
      };
      if (req.method === 'GET' && action === 'contexts' && !org) {
        return db.tx(async (c) => {
          await lock(c, s);
          const m = await db.member(s, u, null, c);
          const organizations = (
            await c.query(
              `SELECT o.org_id,o.name FROM hd_organizations o WHERE o.school_id=$1 AND o.active AND
            ($3='owner' OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=o.school_id AND g.org_id=o.org_id AND g.user_id=$2 AND g.active AND g.role='owner')) ORDER BY o.org_id`,
              [s, u, m.role],
            )
          ).rows;
          return send({ schoolAccessible: m.role === 'owner', organizations });
        });
      }
      await scope(db, s, u, org, 'manage');
      if (req.method === 'GET')
        return db.tx(async (c) => {
          await authorize(c, s, u, org);
          if (action === 'setup') {
            const people = (
              await c.query(
                `SELECT m.user_id,u.display_name,m.role,
              EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=m.school_id AND g.org_id=$2 AND g.user_id=m.user_id AND g.active AND g.role='owner') AS organization_owner
              FROM hd_memberships m JOIN hd_users u USING(user_id) WHERE m.school_id=$1 AND m.active AND u.enabled AND
              (($2::text IS NULL AND m.role NOT IN ('partner','affiliate')) OR ($2 IS NOT NULL AND (m.role='owner' OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=m.school_id AND g.org_id=$2 AND g.user_id=m.user_id AND g.active)))) ORDER BY u.display_name`,
                [s, org],
              )
            ).rows;
            return send({
              people: people.map((p) => ({
                userId: p.user_id,
                displayName: p.display_name,
                canManage: p.role === 'owner' || p.organization_owner,
              })),
              rules: (
                await c.query(
                  "SELECT rule_version,document->>'label' AS label,fingerprint FROM hd_campus_rules WHERE school_id=$1 AND status='approved' ORDER BY rule_version",
                  [s],
                )
              ).rows,
              rewards: (
                await c.query(
                  "SELECT reward_id,title,revision,expires_at FROM hd_rewards WHERE school_id=$1 AND coalesce(org_id,'')=$2 AND status='published' AND expires_at>now() ORDER BY title",
                  [s, org || ''],
                )
              ).rows,
            });
          }
          if (action === 'example')
            return send(
              validateOperationsPackage(
                JSON.parse(
                  await readFile(
                    new URL('../../examples/operations/campus-starter-v1.json', import.meta.url),
                    'utf8',
                  ),
                ),
              ),
            );
          if (action === 'packages') {
            if (id) {
              const d = await docRow(c, s, org, id, Number(url.searchParams.get('version'))),
                before = d.version > 1 ? await docRow(c, s, org, id, d.version - 1) : null;
              return send({ ...d, diff: operationsDiff(before?.document, d.document) });
            }
            return send({
              packages: (
                await c.query(
                  "SELECT package_id,version,fingerprint,imported_by,imported_at,document->>'name' AS name,document->>'sourceLabel' AS source_label,document->'exampleOnly' AS example_only FROM hd_operation_packages WHERE school_id=$1 AND scope_id=$2 ORDER BY package_id,version DESC",
                  [s, org || ''],
                )
              ).rows,
              heads: (
                await c.query(
                  'SELECT * FROM hd_operation_heads WHERE school_id=$1 AND scope_id=$2',
                  [s, org || ''],
                )
              ).rows,
            });
          }
          if (action === 'runs') {
            if (id) return send(await report(c, s, org, await runRow(c, s, org, id)));
            return send({
              items: (
                await c.query(
                  'SELECT run_id,title,package_id,package_version,revision,responsible_id,created_at FROM hd_operation_runs WHERE school_id=$1 AND scope_id=$2 ORDER BY created_at DESC LIMIT 200',
                  [s, org || ''],
                )
              ).rows,
            });
          }
          throw problem('operations_route_missing', 404);
        });
      const b = await body(req);
      if (action === 'preview')
        return db.tx(async (c) => {
          await authorize(c, s, u, org);
          fields(b, ['document'], 'operations_preview');
          return send(await preview(c, s, org, b.document));
        });
      if (action === 'runs' && id === 'preview')
        return db.tx(async (c) => {
          await authorize(c, s, u, org);
          return send(await runPlan(c, s, u, org, b));
        });
      const mutate = (fn) =>
        db.receipt(
          s,
          u,
          b.requestId,
          { module: 'operations', path: url.pathname, input: b },
          fn,
          (c) => authorize(c, s, u, org),
        );
      if (action === 'import') {
        fields(
          b,
          ['requestId', 'document', 'expectedLatestVersion', 'previewHash', 'confirmed', 'reason'],
          'operations_import',
        );
        return send(
          await mutate(async (c) => {
            const v = await preview(c, s, org, b.document);
            txt(b.reason, 3, 500);
            if (b.confirmed !== true || v.documentHash !== b.previewHash)
              throw problem('operations_preview_confirmation_required', 409);
            if (v.previousVersion !== b.expectedLatestVersion)
              throw problem('operations_version_conflict', 409);
            await c.query(
              'INSERT INTO hd_operation_packages(school_id,scope_id,package_id,version,document,fingerprint,imported_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                s,
                org || '',
                v.document.packageId,
                v.document.version,
                v.document,
                v.documentHash,
                u,
                b.reason,
              ],
            );
            await audit(c, s, u, 'operations.import', v.document.packageId, {
              version: v.document.version,
              fingerprint: v.documentHash,
              reason: b.reason,
            });
            return {
              packageId: v.document.packageId,
              version: v.document.version,
              fingerprint: v.documentHash,
              active: false,
            };
          }),
        );
      }
      if (action === 'activate') {
        fields(
          b,
          ['requestId', 'packageId', 'version', 'expectedRevision', 'confirmed', 'reason'],
          'operations_activate',
        );
        return send(
          await mutate(async (c) => {
            const d = await docRow(c, s, org, b.packageId, b.version),
              old = await head(c, s, org, b.packageId);
            integer(b.expectedRevision, 0, 100000);
            txt(b.reason, 3, 500);
            if (b.confirmed !== true) throw problem('operations_confirmation_required', 409);
            if ((old?.revision || 0) !== b.expectedRevision)
              throw problem('operations_activation_conflict', 409);
            await c.query(
              'INSERT INTO hd_operation_heads(school_id,scope_id,package_id,active_version,revision,activated_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(school_id,scope_id,package_id) DO UPDATE SET active_version=EXCLUDED.active_version,revision=EXCLUDED.revision,activated_by=EXCLUDED.activated_by,reason=EXCLUDED.reason,activated_at=now()',
              [s, org || '', b.packageId, b.version, b.expectedRevision + 1, u, b.reason],
            );
            await audit(c, s, u, 'operations.activate', b.packageId, {
              version: b.version,
              previousVersion: old?.active_version || null,
              reason: b.reason,
            });
            return {
              packageId: b.packageId,
              activeVersion: d.version,
              revision: b.expectedRevision + 1,
              changesExistingRuns: false,
            };
          }),
        );
      }
      if (action === 'runs' && !id) {
        fields(b, [...planFields, 'requestId', 'previewHash', 'confirmed'], 'operations_run');
        return send(
          await mutate(async (c) => {
            if (b.confirmed !== true) throw problem('operations_confirmation_required', 409);
            const input = Object.fromEntries(
                planFields.filter((k) => k in b).map((k) => [k, b[k]]),
              ),
              v = await runPlan(c, s, u, org, input);
            if (v.previewHash !== b.previewHash)
              throw problem('operations_schedule_preview_stale', 409);
            if (!createActivityDraft) throw problem('operations_activities_unavailable', 503);
            const activities = [];
            for (const slot of v.slots) {
              const a = await createActivityDraft(c, { schoolId: s, userId: u, input: slot.input });
              if (a.status !== 'draft') throw problem('operations_draft_contract_invalid', 500);
              activities.push({
                templateId: slot.templateId,
                activityId: a.activityId,
                createdRevision: a.revision,
              });
            }
            const runId = randomUUID();
            await c.query(
              'INSERT INTO hd_operation_runs(school_id,run_id,scope_id,package_id,package_version,package_fingerprint,responsible_id,created_by,title,plan,activities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
              [
                s,
                runId,
                org || '',
                b.packageId,
                b.packageVersion,
                v.packageHash,
                b.responsibleId,
                u,
                b.title,
                v,
                JSON.stringify(activities),
              ],
            );
            await audit(c, s, u, 'operations.schedule', runId, {
              packageId: b.packageId,
              packageVersion: b.packageVersion,
              responsibleId: b.responsibleId,
              activities,
            });
            return {
              runId,
              revision: 1,
              status: 'draft-activities-created',
              activities,
              publishesActivities: false,
              issuesRewards: false,
            };
          }),
        );
      }
      if (action === 'runs' && sub === 'handoff') {
        fields(
          b,
          ['requestId', 'expectedRevision', 'responsibleId', 'reason'],
          'operations_handoff',
        );
        return send(
          await mutate(async (c) => {
            const r = await runRow(c, s, org, id);
            integer(b.expectedRevision, 1, 100000);
            txt(b.reason, 3, 500);
            if (!uuid(b.responsibleId)) throw problem('operations_people_invalid');
            if (r.revision !== b.expectedRevision) throw problem('operations_run_conflict', 409);
            await scope(db, s, b.responsibleId, org, 'manage', c);
            const entry = {
              from: r.responsible_id,
              to: b.responsibleId,
              by: u,
              reason: b.reason,
              at: new Date().toISOString(),
              revision: r.revision + 1,
            };
            await c.query(
              'UPDATE hd_operation_runs SET responsible_id=$3,revision=revision+1,handoffs=handoffs||$4::jsonb,updated_at=now() WHERE school_id=$1 AND run_id=$2',
              [s, id, b.responsibleId, JSON.stringify([entry])],
            );
            await audit(c, s, u, 'operations.handoff', id, entry);
            return {
              runId: id,
              revision: r.revision + 1,
              responsibleId: b.responsibleId,
              grantsPermissions: false,
            };
          }),
        );
      }
      throw problem('operations_route_missing', 404);
    },
  };
}
