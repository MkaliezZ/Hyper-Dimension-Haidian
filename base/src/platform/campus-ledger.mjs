import { randomUUID } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { canonical, fields } from '../protocol/index.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { contactReceipt } from './contacts.mjs';

const kinds = ['forum_published', 'activity_verified', 'volunteer_verified'];
const key = (v) => {
  if (
    typeof v !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(v) ||
    ['__proto__', 'constructor', 'prototype'].includes(v)
  )
    throw problem('ledger_id_invalid');
  return v;
};
const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const text = (v, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max)
    throw problem('ledger_text_invalid');
  return v.trim();
};
const date = (v) => {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
    throw problem('ledger_date_invalid');
  return new Date(v).toISOString();
};
const compare = (r, v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw problem('ledger_revision_required');
  if (r.revision !== v) throw problem('revision_conflict', 409);
};
export const exampleRules = {
  schema: 'hyper-dimension.contribution-rules/v1',
  version: 'fictional-example-v1',
  exampleOnly: true,
  label: '虚构演示规则，需学校自行确认',
  dailyCap: 30,
  rules: {
    forum_published: { points: 5, dayCap: 10 },
    activity_verified: { points: 10, dayCap: 20 },
    volunteer_verified: { points: 15, dayCap: 30 },
  },
};
export function validateRules(input) {
  fields(
    input,
    ['schema', 'version', 'exampleOnly', 'label', 'dailyCap', 'rules'],
    'contribution_rules',
  );
  if (
    input.schema !== 'hyper-dimension.contribution-rules/v1' ||
    typeof input.exampleOnly !== 'boolean' ||
    !Number.isSafeInteger(input.dailyCap) ||
    input.dailyCap < 0 ||
    input.dailyCap > 100000
  )
    throw problem('rules_schema_invalid');
  key(input.version);
  text(input.label, 3, 160);
  fields(input.rules, kinds, 'contribution_rule_kinds');
  for (const kind of kinds) {
    const r = fields(input.rules[kind], ['points', 'dayCap'], 'contribution_rule');
    if (
      !Number.isSafeInteger(r.points) ||
      r.points < 0 ||
      r.points > 10000 ||
      !Number.isSafeInteger(r.dayCap) ||
      r.dayCap < 0 ||
      r.dayCap > 100000
    )
      throw problem('rule_value_invalid');
  }
  return JSON.parse(canonical(input));
}
async function ledgerLock(c, school) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [school + ':ledger']);
}
async function permissionsLock(c, school) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [school + ':permissions']);
}
async function periodRow(c, school, id) {
  key(id);
  const r = (
    await c.query('SELECT * FROM hd_campus_periods WHERE school_id=$1 AND period=$2', [school, id])
  ).rows[0];
  if (!r) throw problem('ledger_period_missing', 404);
  return r;
}
async function recordScore(c, school, user, period, delta) {
  if (!delta) return;
  const score = (
    await c.query(
      `INSERT INTO hd_scores VALUES($1,$2,$3,$4,1) ON CONFLICT(school_id,user_id,period)
   DO UPDATE SET score=hd_scores.score+EXCLUDED.score,version=hd_scores.version+1 RETURNING *`,
      [school, user, period, delta],
    )
  ).rows[0];
  await c.query(
    'INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES($1,$2,$3,$4,$5)',
    [school, user, period, score.score, score.version],
  );
}
export function createCampusLedger(db, identity, services, config) {
  async function store(c, e, sourceId, user, org, kind, decision) {
    await c.query('INSERT INTO hd_events VALUES($1,$2,$3,$4,$5,$6)', [
      e.eventId,
      e.schoolId,
      sourceId,
      e.source.revision,
      e,
      hash(canonical(e)),
    ]);
    const { delta, period, ruleVersion, reason, reverses = null } = decision;
    const metadata = {
      kind,
      sourceSystem: e.source.system || e.source.kind,
      sourceId: e.source.id,
      sourceRevision: e.source.revision,
      occurredAt: e.occurredAt,
      day: date(e.occurredAt).slice(0, 10),
      reason,
      ruleVersion,
      ...(decision.ruleFingerprint ? { ruleFingerprint: decision.ruleFingerprint } : {}),
      ...(decision.ruleTerms ? { ruleTerms: decision.ruleTerms } : {}),
      ...(decision.adjustmentReason ? { adjustmentReason: decision.adjustmentReason } : {}),
      ...(e.reversesEventId ? { reversesEventId: e.reversesEventId } : {}),
    };
    const entry = (
      await c.query(
        `INSERT INTO hd_contributions(event_id,school_id,user_id,period,delta,rule_version,reverses,scope_id,kind,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          e.eventId,
          e.schoolId,
          user,
          period,
          delta,
          ruleVersion,
          reverses,
          org || '',
          kind,
          metadata,
        ],
      )
    ).rows[0];
    await recordScore(c, e.schoolId, user, period, delta);
    await c.query(
      'INSERT INTO hd_notifications(school_id,user_id,event_id,payload,scope_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [
        e.schoolId,
        user,
        'ledger:' + e.eventId,
        {
          type: 'contribution',
          entryId: entry.id,
          delta,
          period,
          ruleVersion,
          reason,
          organizationId: org || null,
        },
        org || '',
      ],
    );
    return {
      duplicate: false,
      eventId: e.eventId,
      entryId: entry.id,
      delta,
      period,
      ruleVersion,
      reason,
    };
  }
  async function duplicate(c, e) {
    const old = (await c.query('SELECT * FROM hd_events WHERE event_id=$1', [e.eventId])).rows[0];
    if (!old) return null;
    if (old.school_id !== e.schoolId || canonical(old.envelope) !== canonical(e))
      throw problem('event_conflict', 409);
    const r = (await c.query('SELECT * FROM hd_contributions WHERE event_id=$1', [e.eventId]))
      .rows[0];
    return {
      duplicate: true,
      eventId: e.eventId,
      ...(r
        ? {
            entryId: r.id,
            delta: r.delta,
            period: r.period,
            ruleVersion: r.rule_version,
            reason: r.metadata?.reason || 'legacy',
          }
        : { delta: 0, ruleVersion: 'legacy-preserved' }),
    };
  }
  async function award(c, e, user, org, kind) {
    const occurredAt = date(e.occurredAt);
    const p = (
      await c.query(
        `SELECT p.*,r.document,r.fingerprint FROM hd_campus_periods p JOIN hd_campus_rules r USING(school_id,rule_version)
    WHERE p.school_id=$1 AND p.scope_id=$2 AND p.status='active' AND r.status='approved'
    AND p.starts_at<=$3 AND p.ends_at>$3 AND p.activated_at<=$3 ORDER BY p.starts_at DESC LIMIT 1`,
        [e.schoolId, org || '', occurredAt],
      )
    ).rows[0];
    if (!p)
      return {
        delta: 0,
        period: 'campus-unconfigured',
        ruleVersion: 'unconfigured',
        reason: 'no_effective_approved_rule',
      };
    let qualified = true;
    try {
      await scope(db, e.schoolId, user, org, 'read', c);
    } catch (err) {
      if (err.status !== 403) throw err;
      qualified = false;
    }
    const base = {
      period: p.period,
      ruleVersion: p.rule_version,
      ruleFingerprint: p.fingerprint,
      ruleTerms: {
        ...p.document.rules[kind],
        dailyCap: p.document.dailyCap,
        exampleOnly: p.document.exampleOnly,
      },
    };
    if (!qualified) return { ...base, delta: 0, reason: 'member_or_organization_ineligible' };
    const sums = (
      await c.query(
        `SELECT coalesce(sum(delta),0)::int AS total,coalesce(sum(delta) FILTER(WHERE kind=$4),0)::int AS kind_total
   FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND delta>0
   AND metadata->>'day'=$5 AND kind=ANY($6::text[])`,
        [e.schoolId, user, org || '', kind, occurredAt.slice(0, 10), kinds],
      )
    ).rows[0];
    const rule = p.document.rules[kind],
      delta = Math.max(
        0,
        Math.min(rule.points, rule.dayCap - sums.kind_total, p.document.dailyCap - sums.total),
      );
    return {
      ...base,
      delta,
      reason: delta < rule.points ? 'daily_cap_applied' : 'approved_rule_applied',
    };
  }
  async function reverse(c, e, user, org, reference) {
    const original = (
      await c.query(
        'SELECT c.*,e.envelope FROM hd_contributions c JOIN hd_events e USING(event_id) WHERE c.event_id=$1 AND c.school_id=$2',
        [reference, e.schoolId],
      )
    ).rows[0];
    if (!original) {
      // Source verification may predate this extension. Preserve a zero reversal rather than inventing credit.
      return {
        delta: 0,
        period: 'campus-unconfigured',
        ruleVersion: 'unconfigured',
        reason: 'original_not_credited',
      };
    }
    if (
      original.user_id !== user ||
      (original.kind !== 'legacy' && original.scope_id !== (org || ''))
    )
      throw problem('reversal_scope_conflict', 409);
    const already =
      (await c.query('SELECT id FROM hd_contributions WHERE reverses=$1', [original.id])).rowCount >
      0;
    if (already)
      return {
        delta: 0,
        period: original.period,
        ruleVersion: original.rule_version,
        reason: 'original_already_reversed',
      };
    if (original.delta < 0) throw problem('cannot_reverse_reversal', 409);
    return {
      delta: -original.delta,
      period: original.period,
      ruleVersion: original.rule_version,
      reverses: original.id,
      reason: 'original_exact_reversal',
    };
  }
  async function recordContribution(c, e) {
    if (
      !e ||
      e.schema !== 'hyper-dimension.event/v1' ||
      !validId(e.schoolId) ||
      !e.source ||
      !Number.isSafeInteger(e.source.revision) ||
      e.source.revision < 1
    )
      throw problem('invalid_source_event');
    await ledgerLock(c, e.schoolId);
    const repeated = await duplicate(c, e);
    if (repeated) return repeated;
    const system = e.source.system || e.source.kind;
    if (system === 'nodebb') {
      if (
        e.source.system !== 'nodebb' ||
        e.actor?.kind !== 'human' ||
        !uuid(e.actor.userId) ||
        !uuid(e.subject?.userId) ||
        !validId(e.source.id) ||
        !['published', 'withdrawn'].includes(e.status) ||
        e.eventId !== `${e.schoolId}:nodebb:${e.source.id}:${e.source.revision}`
      )
        throw problem('invalid_source_event');
      const head = (
        await c.query('SELECT * FROM hd_forum_heads WHERE school_id=$1 AND source_id=$2', [
          e.schoolId,
          e.source.id,
        ])
      ).rows[0];
      if (
        e.source.revision !== (head?.revision || 0) + 1 ||
        (head && head.user_id !== e.subject.userId)
      )
        throw problem('source_revision_conflict', 409);
      const org = e.organizationId || null,
        user = e.subject.userId,
        kind = e.status === 'published' ? 'forum_published' : 'forum_withdrawn';
      if (
        !(
          await c.query('SELECT 1 FROM hd_memberships WHERE school_id=$1 AND user_id=$2', [
            e.schoolId,
            user,
          ])
        ).rowCount
      )
        throw problem('event_subject_unknown');
      let decision;
      if (e.status === 'published' && head?.status === 'published')
        decision = {
          delta: 0,
          period: 'campus-unconfigured',
          ruleVersion: 'no-extra-award',
          reason: 'published_revision_no_extra_credit',
        };
      else if (e.status === 'withdrawn') {
        const original = (
          await c.query(
            `SELECT c.event_id FROM hd_contributions c JOIN hd_events x USING(event_id)
     WHERE c.school_id=$1 AND x.source_id=$2 AND c.delta>=0 AND (c.kind='legacy' OR (c.kind='forum_published' AND c.metadata->>'reason'<>'published_revision_no_extra_credit')) ORDER BY c.id DESC LIMIT 1`,
            [e.schoolId, e.source.id],
          )
        ).rows[0];
        decision = await reverse(c, e, user, org, original?.event_id || 'missing');
      } else decision = await award(c, e, user, org, kind);
      await c.query(
        `INSERT INTO hd_forum_heads VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,source_id) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status`,
        [e.schoolId, e.source.id, e.source.revision, e.status, user],
      );
      return store(c, e, e.source.id, user, org, kind, decision);
    }
    if (
      system !== 'base-activities' ||
      !['activity_verified', 'volunteer_verified', 'participation_revoked'].includes(e.kind) ||
      !uuid(e.userId) ||
      !uuid(e.actorId) ||
      !uuid(e.source.id) ||
      e.registrationId !== e.source.id ||
      e.eventId !== `${e.schoolId}:base-activities:${e.source.id}:${e.source.revision}`
    )
      throw problem('invalid_activity_event');
    const stored = (
      await c.query('SELECT * FROM hd_activity_events WHERE school_id=$1 AND event_id=$2', [
        e.schoolId,
        e.eventId,
      ])
    ).rows[0];
    if (!stored || canonical(stored.envelope) !== canonical(e))
      throw problem('unverified_activity_source', 409);
    const chain = (
      await c.query(
        'SELECT source_revision,kind,envelope,event_id FROM hd_activity_events WHERE school_id=$1 AND object_id=$2 AND source_revision<=$3 ORDER BY source_revision',
        [e.schoolId, e.source.id, e.source.revision],
      )
    ).rows;
    if (chain.length !== e.source.revision || chain.some((x, i) => x.source_revision !== i + 1))
      throw problem('activity_source_chain_incomplete', 409);
    let decision;
    if (e.kind === 'participation_revoked') {
      const original = chain.find((x) => x.event_id === e.reversesEventId);
      if (
        !original ||
        !['activity_verified', 'volunteer_verified'].includes(original.kind) ||
        original.envelope.userId !== e.userId ||
        original.envelope.orgId !== e.orgId ||
        original.source_revision >= e.source.revision
      )
        throw problem('activity_reversal_source_invalid', 409);
      decision = await reverse(c, e, e.userId, e.orgId, e.reversesEventId);
    } else {
      if (e.actorId === e.userId) throw problem('contribution_self_verification_denied', 403);
      const a = (
        await c.query('SELECT * FROM hd_activities WHERE school_id=$1 AND activity_id=$2', [
          e.schoolId,
          e.activityId,
        ])
      ).rows[0];
      if (
        !a ||
        !a.verifier_ids.includes(e.actorId) ||
        a.org_id !== (e.orgId || null) ||
        (a.kind === 'volunteer') !== (e.kind === 'volunteer_verified')
      )
        throw problem('activity_verifier_invalid', 403);
      await scope(db, e.schoolId, e.actorId, e.orgId, 'read', c);
      const previous = chain
        .filter(
          (x) =>
            ['activity_verified', 'volunteer_verified'].includes(x.kind) &&
            x.source_revision < e.source.revision,
        )
        .at(-1);
      if (
        previous &&
        !chain.some(
          (x) =>
            x.kind === 'participation_revoked' && x.envelope.reversesEventId === previous.event_id,
        )
      )
        throw problem('activity_already_credited', 409);
      decision = await award(c, e, e.userId, e.orgId, e.kind);
    }
    return store(c, e, 'base-activities:' + e.source.id, e.userId, e.orgId, e.kind, decision);
  }
  async function mutate(school, user, path, b, org, fn) {
    return db.tx(async (c) => {
      await permissionsLock(c, school);
      await scope(db, school, user, org, 'manage', c);
      await ledgerLock(c, school);
      return contactReceipt(c, school, user, path, b, () => fn(c));
    });
  }
  async function ranking(c, school, org, { period, semester } = {}) {
    const values = [school, org || ''];
    let filter = '';
    if (period && period !== 'all') {
      key(period);
      values.push(period);
      filter = ' AND c.period=$3';
    } else if (semester) {
      key(semester);
      values.push(semester);
      filter = ' AND p.semester=$3';
    }
    return (
      await c.query(
        `SELECT c.user_id,sum(c.delta)::int AS score FROM hd_contributions c
   LEFT JOIN hd_campus_periods p ON p.school_id=c.school_id AND p.period=c.period
   JOIN hd_memberships m ON m.school_id=c.school_id AND m.user_id=c.user_id AND m.active
   JOIN hd_users u ON u.user_id=c.user_id AND u.enabled
   WHERE c.school_id=$1 AND c.scope_id=$2 ${filter}
   AND (($2='' AND m.role NOT IN ('partner','affiliate')) OR ($2<>'' AND (m.role='owner' OR EXISTS(SELECT 1 FROM hd_org_members g WHERE g.school_id=c.school_id AND g.org_id=$2 AND g.user_id=c.user_id AND g.active))))
   GROUP BY c.user_id ORDER BY score DESC,c.user_id ASC`,
        values,
      )
    ).rows.map((r, i) => ({ userId: r.user_id, score: r.score, position: i + 1 }));
  }
  async function snapshot(c, school, p) {
    const rows = await ranking(c, school, p.scope_id, { period: p.period }),
      generation = p.snapshot_generation + 1;
    for (const r of rows)
      await c.query(
        'INSERT INTO hd_campus_rank_snapshots(school_id,period,generation,user_id,score,position) VALUES($1,$2,$3,$4,$5,$6)',
        [school, p.period, generation, r.userId, r.score, r.position],
      );
    await c.query(
      'UPDATE hd_campus_periods SET snapshot_generation=$3 WHERE school_id=$1 AND period=$2',
      [school, p.period, generation],
    );
    return { generation, count: rows.length };
  }
  async function handle(req, res, { url, json, body }) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'ledger' || parts[1] !== 'schools') return false;
    if (!['GET', 'POST'].includes(req.method)) throw problem('method_denied', 405);
    const school = services.school(parts[2]).schoolId,
      user = (await identity.user(req)).user_id,
      resource = parts[3],
      id = parts[4],
      action = parts[5],
      path = url.pathname;
    await db.member(school, user);
    const org = url.searchParams.get('org') || null,
      send = (x) => {
        json(res, 200, x);
        return true;
      };
    if (resource === 'rules' && req.method === 'POST' && id === 'preview') {
      await scope(db, school, user, null, 'manage');
      const b = fields(await body(req), ['document'], 'rule_preview'),
        document = validateRules(b.document);
      return send({
        document,
        fingerprint: hash(canonical(document)),
        effective: false,
        exampleOnly: document.exampleOnly,
        warnings: document.exampleOnly ? ['虚构示例，尚未代表学校政策'] : [],
      });
    }
    if (resource === 'rules' && req.method === 'GET' && id) {
      key(id);
      await scope(db, school, user, org);
      const rule = (
        await db.pool.query(
          "SELECT document,fingerprint,approved_at FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2 AND status='approved'",
          [school, id],
        )
      ).rows[0];
      if (!rule) throw problem('approved_rule_missing', 404);
      return send(rule);
    }
    if (resource === 'rules' && req.method === 'GET') {
      await scope(db, school, user, org);
      const schoolOwner = (await db.member(school, user)).role === 'owner';
      return send({
        ...(schoolOwner ? { example: exampleRules } : {}),
        rules: (
          await db.pool.query(
            `SELECT rule_version,document,fingerprint,status,revision,created_at,approved_at FROM hd_campus_rules WHERE school_id=$1 ${schoolOwner ? '' : "AND status='approved'"} ORDER BY created_at DESC`,
            [school],
          )
        ).rows,
      });
    }
    if (resource === 'rules' && req.method === 'POST') {
      const b = fields(
        await body(req),
        id ? ['requestId', 'expectedRevision', 'reason'] : ['requestId', 'document'],
        'rules',
      );
      if (id && action !== 'approve') throw problem('ledger_route_missing', 404);
      const document = !id ? validateRules(b.document) : null;
      return send(
        await mutate(school, user, path, b, null, async (c) => {
          if (!id) {
            const existing = (
              await c.query(
                'SELECT 1 FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2',
                [school, document.version],
              )
            ).rowCount;
            if (existing) throw problem('rule_version_immutable', 409);
            await c.query(
              "INSERT INTO hd_campus_rules(school_id,rule_version,document,fingerprint,status,imported_by) VALUES($1,$2,$3,$4,'draft',$5)",
              [school, document.version, document, hash(canonical(document)), user],
            );
            await audit(c, school, user, 'ledger.rule.import', document.version, {
              exampleOnly: document.exampleOnly,
            });
          } else {
            key(id);
            text(b.reason, 3, 1000);
            const r = (
              await c.query(
                'SELECT * FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2',
                [school, id],
              )
            ).rows[0];
            if (!r) throw problem('rule_missing', 404);
            compare(r, b.expectedRevision);
            if (r.status !== 'draft') throw problem('rule_already_approved', 409);
            await c.query(
              "UPDATE hd_campus_rules SET status='approved',revision=revision+1,approved_by=$3,approval_reason=$4,approved_at=now() WHERE school_id=$1 AND rule_version=$2",
              [school, id, user, b.reason],
            );
            await audit(c, school, user, 'ledger.rule.approve', id, { reason: b.reason });
          }
          return (
            await c.query('SELECT * FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2', [
              school,
              id || document.version,
            ])
          ).rows[0];
        }),
      );
    }
    if (resource === 'periods' && req.method === 'GET') {
      await scope(db, school, user, org);
      let canManage = false;
      try {
        await scope(db, school, user, org, 'manage');
        canManage = true;
      } catch (e) {
        if (e.status !== 403) throw e;
      }
      return send({
        canManage,
        periods: (
          await db.pool.query(
            'SELECT * FROM hd_campus_periods WHERE school_id=$1 AND scope_id=$2 ORDER BY starts_at DESC',
            [school, org || ''],
          )
        ).rows,
      });
    }
    if (resource === 'periods' && req.method === 'POST') {
      const b = fields(
        await body(req),
        id
          ? ['requestId', 'expectedRevision', 'reason', 'acknowledgeExample']
          : [
              'requestId',
              'period',
              'orgId',
              'semester',
              'label',
              'ruleVersion',
              'startsAt',
              'endsAt',
            ],
        'ledger_period',
      );
      let p = id ? await periodRow(db.pool, school, id) : null,
        scopeOrg = p?.scope_id || b.orgId || null;
      if (id && !['activate', 'freeze', 'rebuild'].includes(action))
        throw problem('ledger_route_missing', 404);
      return send(
        await mutate(school, user, path, b, scopeOrg, async (c) => {
          if (!id) {
            key(b.period);
            if (['all', 'm0-trial', 'campus-unconfigured'].includes(b.period))
              throw problem('period_reserved');
            key(b.semester);
            key(b.ruleVersion);
            text(b.label, 2, 160);
            const start = date(b.startsAt),
              end = date(b.endsAt);
            if (end <= start) throw problem('period_dates_invalid');
            const r = (
              await c.query(
                "SELECT * FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2 AND status='approved'",
                [school, b.ruleVersion],
              )
            ).rows[0];
            if (!r) throw problem('approved_rule_required', 409);
            if (
              (
                await c.query(
                  'SELECT 1 FROM hd_scores WHERE school_id=$1 AND period=$2 UNION SELECT 1 FROM hd_contributions WHERE school_id=$1 AND period=$2',
                  [school, b.period],
                )
              ).rowCount
            )
              throw problem('period_existing_history', 409);
            await c.query(
              "INSERT INTO hd_campus_periods(school_id,period,scope_id,semester,label,rule_version,starts_at,ends_at,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)",
              [
                school,
                b.period,
                scopeOrg || '',
                b.semester,
                b.label,
                b.ruleVersion,
                start,
                end,
                user,
              ],
            );
            await audit(c, school, user, 'ledger.period.create', b.period, {
              scopeId: scopeOrg,
              ruleVersion: b.ruleVersion,
            });
            return periodRow(c, school, b.period);
          }
          p = await periodRow(c, school, id);
          compare(p, b.expectedRevision);
          text(b.reason, 3, 1000);
          if (action === 'activate') {
            if (p.status !== 'draft' || p.ends_at <= new Date())
              throw problem('period_activation_invalid', 409);
            const r = (
              await c.query(
                'SELECT * FROM hd_campus_rules WHERE school_id=$1 AND rule_version=$2',
                [school, p.rule_version],
              )
            ).rows[0];
            if (r.status !== 'approved') throw problem('approved_rule_required', 409);
            if (r.document.exampleOnly && b.acknowledgeExample !== true)
              throw problem('example_acknowledgement_required');
            if (
              (
                await c.query(
                  "SELECT 1 FROM hd_campus_periods WHERE school_id=$1 AND scope_id=$2 AND status='active' AND starts_at<$4 AND ends_at>$3",
                  [school, p.scope_id, p.starts_at, p.ends_at],
                )
              ).rowCount
            )
              throw problem('active_period_overlap', 409);
            await c.query(
              "UPDATE hd_campus_periods SET status='active',activated_at=now(),revision=revision+1 WHERE school_id=$1 AND period=$2",
              [school, id],
            );
          } else if (action === 'freeze') {
            if (p.status !== 'active') throw problem('period_not_active', 409);
            await snapshot(c, school, p);
            await c.query(
              "UPDATE hd_campus_periods SET status='frozen',frozen_at=now(),revision=revision+1 WHERE school_id=$1 AND period=$2",
              [school, id],
            );
          } else {
            if (p.status === 'draft') throw problem('period_not_active', 409);
            const rows = (
              await c.query(
                `SELECT user_id FROM hd_contributions WHERE school_id=$1 AND period=$2 UNION SELECT user_id FROM hd_scores WHERE school_id=$1 AND period=$2`,
                [school, id],
              )
            ).rows;
            for (const row of rows) {
              const sum = (
                await c.query(
                  'SELECT coalesce(sum(delta),0)::int AS score FROM hd_contributions WHERE school_id=$1 AND period=$2 AND user_id=$3',
                  [school, id, row.user_id],
                )
              ).rows[0].score;
              const old = (
                  await c.query(
                    'SELECT * FROM hd_scores WHERE school_id=$1 AND period=$2 AND user_id=$3',
                    [school, id, row.user_id],
                  )
                ).rows[0],
                outbox = (
                  await c.query(
                    'SELECT coalesce(max(version),0)::int AS v FROM hd_outbox WHERE school_id=$1 AND period=$2 AND user_id=$3',
                    [school, id, row.user_id],
                  )
                ).rows[0];
              const version = Math.max(old?.version || 0, outbox.v) + 1;
              await c.query(
                'INSERT INTO hd_scores VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,user_id,period) DO UPDATE SET score=$4,version=$5',
                [school, row.user_id, id, sum, version],
              );
              await c.query(
                'INSERT INTO hd_outbox(school_id,user_id,period,score,version) VALUES($1,$2,$3,$4,$5)',
                [school, row.user_id, id, sum, version],
              );
            }
            if (p.status === 'frozen') await snapshot(c, school, p);
            await c.query(
              'UPDATE hd_campus_periods SET revision=revision+1 WHERE school_id=$1 AND period=$2',
              [school, id],
            );
          }
          await audit(c, school, user, 'ledger.period.' + action, id, {
            reason: b.reason,
            scopeId: p.scope_id,
          });
          return periodRow(c, school, id);
        }),
      );
    }
    if (resource === 'entries' && req.method === 'GET') {
      await scope(db, school, user, org);
      const target = url.searchParams.get('userId') || user;
      if (!uuid(target)) throw problem('user_invalid');
      if (target !== user) await scope(db, school, user, org, 'manage');
      const after = url.searchParams.get('after') || '0';
      if (!/^\d{1,18}$/.test(after)) throw problem('cursor_invalid');
      return send({
        entries: (
          await db.pool.query(
            'SELECT * FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND id>$4 ORDER BY id LIMIT 200',
            [school, target, org || '', after],
          )
        ).rows,
      });
    }
    if (resource === 'rankings' && req.method === 'GET') {
      await scope(db, school, user, org);
      const period = url.searchParams.get('period') || 'all',
        semester = url.searchParams.get('semester');
      const p = period !== 'all' ? await periodRow(db.pool, school, period) : null;
      if (p && p.scope_id !== (org || '')) throw problem('ranking_scope_denied', 403);
      let rows,
        frozen = p?.status === 'frozen';
      if (frozen) {
        rows = (
          await db.pool.query(
            `SELECT s.user_id,s.score,s.position FROM hd_campus_rank_snapshots s JOIN hd_memberships m USING(school_id,user_id) JOIN hd_users u USING(user_id)
    WHERE s.school_id=$1 AND s.period=$2 AND s.generation=$3 AND m.active AND u.enabled ORDER BY s.position`,
            [school, period, p.snapshot_generation],
          )
        ).rows;
        const safe = [];
        for (const r of rows) {
          try {
            await scope(db, school, r.user_id, org);
            safe.push({ userId: r.user_id, score: r.score, position: r.position });
          } catch (e) {
            if (e.status !== 403) throw e;
          }
        }
        rows = safe;
      } else rows = await ranking(db.pool, school, org, { period, semester });
      const named = [];
      for (const r of rows.slice(0, 200)) {
        const name = (
          await db.pool.query('SELECT display_name FROM hd_users WHERE user_id=$1', [r.userId])
        ).rows[0]?.display_name;
        named.push({ ...r, name });
      }
      await scope(db, school, user, org);
      return send({
        schoolId: school,
        orgId: org,
        period,
        semester: semester || null,
        frozen: Boolean(frozen),
        generation: p?.snapshot_generation || 0,
        tieBreak: 'score DESC, userId ASC',
        rows: named,
      });
    }
    if (resource === 'adjustments' && req.method === 'POST') {
      const b = fields(
        await body(req),
        ['requestId', 'userId', 'orgId', 'period', 'delta', 'reason', 'reversesEntryId'],
        'ledger_adjustment',
      );
      if (!uuid(b.userId)) throw problem('user_invalid');
      text(b.reason, 5, 1000);
      const p = await periodRow(db.pool, school, b.period);
      if (p.scope_id !== (b.orgId || '')) throw problem('adjustment_scope_denied', 403);
      if (
        b.reversesEntryId !== undefined &&
        (!/^\d{1,18}$/.test(String(b.reversesEntryId)) || b.delta !== undefined)
      )
        throw problem('adjustment_reversal_invalid');
      if (
        b.reversesEntryId === undefined &&
        (!Number.isSafeInteger(b.delta) || b.delta === 0 || Math.abs(b.delta) > 10000)
      )
        throw problem('adjustment_delta_invalid');
      return send(
        await mutate(school, user, path, b, p.scope_id || null, async (c) => {
          const currentPeriod = await periodRow(c, school, p.period);
          if (currentPeriod.status === 'draft') throw problem('period_not_active', 409);
          if (b.delta > 0) await scope(db, school, b.userId, p.scope_id || null, 'read', c);
          if (
            !(
              await c.query('SELECT 1 FROM hd_memberships WHERE school_id=$1 AND user_id=$2', [
                school,
                b.userId,
              ])
            ).rowCount
          )
            throw problem('event_subject_unknown');
          let decision = {
            delta: b.delta,
            period: p.period,
            ruleVersion: 'manual-adjustment-v1',
            reason: 'audited_manual_adjustment',
            adjustmentReason: b.reason,
          };
          if (b.reversesEntryId !== undefined) {
            const original = (
              await c.query('SELECT * FROM hd_contributions WHERE school_id=$1 AND id=$2', [
                school,
                b.reversesEntryId,
              ])
            ).rows[0];
            if (
              !original ||
              original.user_id !== b.userId ||
              original.period !== p.period ||
              original.scope_id !== p.scope_id ||
              original.delta <= 0
            )
              throw problem('adjustment_original_invalid', 409);
            decision = {
              ...(await reverse(c, { schoolId: school }, b.userId, p.scope_id, original.event_id)),
              adjustmentReason: b.reason,
            };
            if (decision.reason === 'original_already_reversed')
              throw problem('original_already_reversed', 409);
          }
          const object = randomUUID(),
            e = {
              schema: 'hyper-dimension.event/v1',
              eventId: `${school}:base-adjustment:${object}:1`,
              schoolId: school,
              source: { system: 'base-adjustment', id: object, revision: 1 },
              actor: { kind: 'human', userId: user },
              subject: { userId: b.userId },
              occurredAt: new Date().toISOString(),
              organizationId: p.scope_id || null,
              reason: b.reason,
              delta: decision.delta,
            };
          const result = await store(
            c,
            e,
            'base-adjustment:' + object,
            b.userId,
            p.scope_id,
            'manual_adjustment',
            decision,
          );
          await audit(c, school, user, 'ledger.manual_adjustment', result.entryId, {
            reason: b.reason,
            delta: decision.delta,
            period: p.period,
            userId: b.userId,
          });
          return result;
        }),
      );
    }
    throw problem('ledger_route_missing', 404);
  }
  return { handle, recordContribution };
}
