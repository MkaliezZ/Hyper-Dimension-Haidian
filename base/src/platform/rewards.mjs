import { randomUUID } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { scope, audit, validId } from './permissions.mjs';
import { fields, canonical } from '../protocol/index.mjs';
import { REWARD_PART, REWARD_ITEM } from '../avatar/catalog-m2-v3.mjs';

const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const text = (v, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max)
    throw problem('reward_text_invalid');
  return v.trim();
};
const view = (r) =>
  r
    ? Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
      )
    : null;
const compare = (r, n) => {
  if (!Number.isSafeInteger(n) || n < 1) throw problem('expected_revision_required');
  if (r.revision !== n) throw problem('revision_conflict', 409);
};
const current = (r) =>
  r.status === 'published' &&
  new Date(r.starts_at) <= new Date() &&
  new Date(r.expires_at) > new Date();
const activeClaim = (r) => r.status === 'fulfilled' && new Date(r.expires_at) > new Date();
const rewardFields = [
  'orgId',
  'kind',
  'title',
  'description',
  'target',
  'minimumContribution',
  'contributionPeriod',
  'stock',
  'startsAt',
  'expiresAt',
  'demonstration',
];

// Quantity lives exclusively in M2. The receipt supplies expiry/provenance for each issued right.
export async function hasRewardItem(c, school, user, item) {
  return Boolean(
    (
      await c.query(
        `SELECT 1 FROM hd_m2_items i WHERE i.school_id=$1 AND i.user_id=$2 AND i.item_id=$3 AND i.quantity>0
  AND EXISTS(SELECT 1 FROM hd_reward_claims x JOIN hd_rewards r USING(school_id,reward_id)
  WHERE x.school_id=i.school_id AND x.user_id=i.user_id AND x.status='fulfilled' AND x.expires_at>now()
  AND x.authority_receipt->>'itemId'=i.item_id
  AND (r.org_id IS NULL OR EXISTS(SELECT 1 FROM hd_org_members m JOIN hd_organizations o USING(school_id,org_id) WHERE m.school_id=r.school_id AND m.org_id=r.org_id AND m.user_id=i.user_id AND m.active AND o.active)))`,
        [school, user, item],
      )
    ).rowCount,
  );
}
export async function requireRewardAppearance(c, school, user, recipe) {
  if (
    recipe.parts.accessory === REWARD_PART &&
    !(await hasRewardItem(c, school, user, REWARD_ITEM))
  )
    throw problem('appearance_reward_required', 403);
}
export async function requireActivityReward(c, school, user, activityId) {
  const gate = (
    await c.query(
      'SELECT item_id FROM hd_reward_activity_gates WHERE school_id=$1 AND activity_id=$2',
      [school, activityId],
    )
  ).rows[0];
  if (gate && !(await hasRewardItem(c, school, user, gate.item_id)))
    throw problem('activity_reward_required', 403);
}
export function createRewards(
  db,
  identity,
  services,
  config,
  { issuePartnerEntitlement, revokePartnerEntitlement } = {},
) {
  const row = async (c, s, id, claim = false) => {
    if (!uuid(id)) throw problem('reward_id_invalid');
    const r = (
      await c.query(
        `SELECT * FROM ${claim ? 'hd_reward_claims' : 'hd_rewards'} WHERE school_id=$1 AND ${claim ? 'claim_id' : 'reward_id'}=$2`,
        [s, id],
      )
    ).rows[0];
    if (!r) throw problem('reward_missing', 404);
    return r;
  };
  const allowed = (c, s, u, r, manage = false) =>
    scope(db, s, u, r.org_id, manage ? 'manage' : 'read', c);
  async function locks(c, s) {
    for (const key of [s + ':permissions', s + ':information', s + ':rewards'])
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
  async function mutate(s, u, route, b, acl, fn) {
    if (!validId(b.requestId)) throw problem('request_id_required');
    const fingerprint = hash(canonical({ route, b }));
    await acl(db.pool);
    return db.tx(async (c) => {
      await locks(c, s);
      await acl(c);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        s + ':' + u + ':' + b.requestId,
      ]);
      const old = (
        await c.query(
          'SELECT * FROM hd_receipts WHERE school_id=$1 AND user_id=$2 AND request_id=$3',
          [s, u, b.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== fingerprint) throw problem('request_conflict', 409);
        return old.result;
      }
      const result = await fn(c);
      await c.query('INSERT INTO hd_receipts VALUES($1,$2,$3,$4,$5)', [
        s,
        u,
        b.requestId,
        fingerprint,
        result,
      ]);
      return result;
    });
  }
  async function event(c, s, actor, r, claim, kind, revision, detail = {}) {
    const eventId = `${s}:rewards:${claim?.claim_id || r.reward_id}:${revision}`;
    await c.query(
      'INSERT INTO hd_reward_events(event_id,school_id,reward_id,claim_id,actor_id,kind,revision,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [eventId, s, r.reward_id, claim?.claim_id || null, actor, kind, revision, detail],
    );
    await audit(c, s, actor, 'rewards.' + kind, claim?.claim_id || r.reward_id, {
      ...detail,
      ...(!actor ? { actorKind: 'system' } : {}),
    });
    if (claim)
      await c.query(
        'INSERT INTO hd_notifications(school_id,user_id,event_id,payload,scope_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [
          s,
          claim.user_id,
          eventId,
          { type: 'reward', rewardId: r.reward_id, claimId: claim.claim_id, status: kind },
          r.org_id || '',
        ],
      );
    return eventId;
  }
  async function target(c, s, u, kind, t, org) {
    if (kind === 'badge') {
      fields(t, ['label'], 'badge_reward');
      return { label: text(t.label, 1, 60) };
    }
    if (kind === 'appearance') {
      fields(t, ['itemId'], 'appearance_reward');
      if (t.itemId !== REWARD_ITEM) throw problem('reward_appearance_unknown');
      return { itemId: REWARD_ITEM };
    }
    if (kind === 'activity') {
      fields(t, ['activityId', 'itemId'], 'activity_reward');
      if (
        !uuid(t.activityId) ||
        (t.itemId !== undefined && t.itemId !== 'activity-entry:' + t.activityId)
      )
        throw problem('activity_id_invalid');
      const a = (
        await c.query('SELECT * FROM hd_activities WHERE school_id=$1 AND activity_id=$2', [
          s,
          t.activityId,
        ])
      ).rows[0];
      if (!a || a.org_id !== org) throw problem('reward_activity_scope_mismatch', 403);
      await scope(db, s, u, a.org_id, 'manage', c);
      const gate = (
        await c.query(
          'SELECT 1 FROM hd_reward_activity_gates WHERE school_id=$1 AND activity_id=$2',
          [s, t.activityId],
        )
      ).rowCount;
      if (
        !gate &&
        (a.status !== 'draft' ||
          (
            await c.query(
              'SELECT 1 FROM hd_activity_registrations WHERE school_id=$1 AND activity_id=$2',
              [s, t.activityId],
            )
          ).rowCount)
      )
        throw problem('reward_requires_new_draft_activity', 409);
      return { activityId: t.activityId, itemId: 'activity-entry:' + t.activityId };
    }
    if (kind === 'partner') {
      fields(t, ['offerId', 'offerRevision'], 'partner_reward');
      if (!uuid(t.offerId) || !Number.isSafeInteger(t.offerRevision) || t.offerRevision < 1)
        throw problem('reward_offer_invalid');
      const o = (
        await c.query(
          'SELECT o.*,p.status partner_status,p.valid_until partner_expires FROM hd_m5_offers o JOIN hd_m5_partners p USING(school_id,partner_id) WHERE o.school_id=$1 AND o.offer_id=$2',
          [s, t.offerId],
        )
      ).rows[0];
      if (!o || o.org_id !== org) throw problem('reward_offer_scope_mismatch', 403);
      if (
        o.status !== 'published' ||
        o.partner_status !== 'approved' ||
        o.valid_until <= new Date() ||
        o.partner_expires <= new Date() ||
        o.revision !== t.offerRevision
      )
        throw problem('reward_offer_unavailable', 409);
      return { offerId: t.offerId, offerRevision: t.offerRevision };
    }
    throw problem('reward_kind_invalid');
  }
  async function eligibility(c, s, u, r) {
    await allowed(c, s, u, r);
    if (
      r.org_id &&
      ['appearance', 'activity', 'partner'].includes(r.kind) &&
      !(
        await c.query(
          'SELECT 1 FROM hd_org_members m JOIN hd_organizations o USING(school_id,org_id) WHERE m.school_id=$1 AND m.org_id=$2 AND m.user_id=$3 AND m.active AND o.active',
          [s, r.org_id, u],
        )
      ).rowCount
    )
      throw problem('reward_participation_membership_required', 403);
    const score = Number(
      (
        await c.query(
          'SELECT COALESCE(sum(delta),0) score FROM hd_contributions WHERE school_id=$1 AND user_id=$2 AND scope_id=$3 AND ($4::text IS NULL OR period=$4)',
          [s, u, r.org_id || '', r.contribution_period],
        )
      ).rows[0].score,
    );
    if (score < r.minimum_contribution) throw problem('reward_eligibility_denied', 403);
    return {
      score,
      minimum: r.minimum_contribution,
      period: r.contribution_period,
      scopeId: r.org_id || '',
      checkedAt: new Date().toISOString(),
      basis: 'current-authoritative-ledger',
      historicalContributionDeducted: false,
    };
  }
  async function itemChange(c, s, u, actor, claim, item, delta) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      s + ':m2-inventory:' + u,
    ]);
    await c.query(
      'INSERT INTO hd_m2_inventory(school_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [s, u],
    );
    const old = (
      await c.query(
        'SELECT quantity FROM hd_m2_items WHERE school_id=$1 AND user_id=$2 AND item_id=$3 FOR UPDATE',
        [s, u, item],
      )
    ).rows[0];
    const quantity = (old?.quantity || 0) + delta;
    if (quantity < 0 || quantity > 999) throw problem('reward_inventory_conflict', 409);
    await c.query(
      'INSERT INTO hd_m2_items VALUES($1,$2,$3,$4) ON CONFLICT(school_id,user_id,item_id) DO UPDATE SET quantity=$4',
      [s, u, item, quantity],
    );
    await c.query(
      'UPDATE hd_m2_inventory SET revision=revision+1 WHERE school_id=$1 AND user_id=$2',
      [s, u],
    );
    const eventId = randomUUID();
    await c.query(
      'INSERT INTO hd_m2_inventory_events(event_id,school_id,user_id,actor_id,action,item_id,delta,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        eventId,
        s,
        u,
        actor,
        delta > 0 ? 'reward-issued' : 'reward-reversed',
        item,
        delta,
        { rewardClaimId: claim.claim_id, rewardId: claim.reward_id },
      ],
    );
    return { itemId: item, inventoryEventId: eventId, quantity };
  }
  async function fulfil(c, s, u, r, claim) {
    if (!current(r)) throw problem('reward_unavailable', 409);
    await eligibility(c, s, u, r);
    await c.query('SAVEPOINT reward_fulfil');
    let receipt;
    try {
      if (r.kind === 'badge') {
        const count = (
          await c.query(
            "SELECT count(*)::int n FROM hd_personal_badges WHERE school_id=$1 AND user_id=$2 AND status='active' AND (expires_at IS NULL OR expires_at>now())",
            [s, u],
          )
        ).rows[0].n;
        if (count >= 100) throw problem('badge_limit_reached', 409);
        const badgeId = randomUUID();
        await c.query(
          "INSERT INTO hd_personal_badges(badge_id,school_id,user_id,label,issuer_id,reason,status,reward_claim_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8)",
          [
            badgeId,
            s,
            u,
            r.target.label,
            r.reviewed_by,
            '奖励：' + r.title,
            claim.claim_id,
            claim.expires_at,
          ],
        );
        receipt = { badgeId, authority: 'hd_personal_badges' };
      } else if (['appearance', 'activity'].includes(r.kind)) {
        receipt = {
          ...(await itemChange(c, s, u, u, claim, r.target.itemId, 1)),
          authority: 'hd_m2_items',
        };
      } else {
        if (!issuePartnerEntitlement) throw problem('partner_rewards_not_connected', 409);
        const e = await issuePartnerEntitlement(c, {
          schoolId: s,
          userId: u,
          offerId: r.target.offerId,
          expectedRevision: r.target.offerRevision,
          rewardClaimId: claim.claim_id,
          actorId: u,
          expiresAt: claim.expires_at,
        });
        receipt = {
          entitlementId: e.entitlementId,
          partnerId: e.partnerId,
          offerId: e.offerId,
          authority: 'hd_m5_entitlements',
        };
      }
      await c.query('RELEASE SAVEPOINT reward_fulfil');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT reward_fulfil');
      await c.query('RELEASE SAVEPOINT reward_fulfil');
      const error = e.status && e.code ? e.code : 'reward_fulfilment_failed';
      await c.query(
        "UPDATE hd_reward_claims SET status='failed',revision=revision+1,attempts=attempts+1,last_error=$3,updated_at=now() WHERE school_id=$1 AND claim_id=$2",
        [s, claim.claim_id, error],
      );
      const x = await row(c, s, claim.claim_id, true);
      await event(c, s, u, r, x, 'failed', x.revision, { error, retryable: true });
      return view(x);
    }
    await c.query(
      "UPDATE hd_reward_claims SET status='fulfilled',revision=revision+1,attempts=attempts+1,authority_receipt=$3,last_error=NULL,updated_at=now() WHERE school_id=$1 AND claim_id=$2",
      [s, claim.claim_id, receipt],
    );
    const x = await row(c, s, claim.claim_id, true);
    await event(c, s, u, r, x, 'fulfilled', x.revision, { authorityReceipt: receipt });
    return view(x);
  }
  async function revoke(c, s, actor, r, x, reason, expired = false) {
    if (!['fulfilled', 'failed'].includes(x.status))
      throw problem('reward_claim_state_conflict', 409);
    const receipt = x.authority_receipt;
    let reversal = null;
    if (x.status === 'fulfilled') {
      if (r.kind === 'badge') {
        const badge = (
          await c.query(
            'SELECT * FROM hd_personal_badges WHERE school_id=$1 AND badge_id=$2 AND reward_claim_id=$3 FOR UPDATE',
            [s, receipt.badgeId, x.claim_id],
          )
        ).rows[0];
        if (!badge) throw problem('reward_authority_mismatch', 409);
        if (badge.status === 'active')
          await c.query(
            "UPDATE hd_personal_badges SET status='revoked',revoked_at=now(),version=version+1 WHERE badge_id=$1",
            [badge.badge_id],
          );
        reversal = { badgeId: badge.badge_id, status: 'revoked' };
      } else if (['appearance', 'activity'].includes(r.kind))
        reversal = await itemChange(c, s, x.user_id, actor, x, receipt.itemId, -1);
      else {
        if (!revokePartnerEntitlement) throw problem('partner_rewards_not_connected', 409);
        reversal = await revokePartnerEntitlement(c, {
          schoolId: s,
          entitlementId: receipt.entitlementId,
          rewardClaimId: x.claim_id,
          actorId: actor,
          reason,
          expired,
        });
      }
    }
    await c.query(
      'UPDATE hd_reward_claims SET status=$3,revision=revision+1,revoke_reason=$4,updated_at=now() WHERE school_id=$1 AND claim_id=$2',
      [s, x.claim_id, expired ? 'expired' : 'revoked', reason],
    );
    const next = await row(c, s, x.claim_id, true);
    await event(c, s, actor, r, next, next.status, next.revision, {
      reason,
      originalAuthorityReceipt: receipt,
      reversal,
    });
    return view(next);
  }
  async function reconcile(s) {
    services.school(s);
    return db.tx(async (c) => {
      await locks(c, s);
      const rows = (
        await c.query(
          "SELECT * FROM hd_reward_claims WHERE school_id=$1 AND status IN ('fulfilled','failed') AND expires_at<=now() ORDER BY expires_at LIMIT 100",
          [s],
        )
      ).rows;
      for (const x of rows)
        await revoke(c, s, null, await row(c, s, x.reward_id), x, '奖励有效期结束', true);
      return { expired: rows.length };
    });
  }
  async function validateOperationsReward(c, { schoolId, orgId, rewardId, userId }) {
    const r = await row(c, schoolId, rewardId);
    await allowed(c, schoolId, userId, r, true);
    if (r.org_id !== (orgId || null) || r.status !== 'published' || r.expires_at <= new Date())
      throw problem('operations_reward_unavailable', 409);
    return {
      rewardId,
      revision: r.revision,
      title: r.title,
      kind: r.kind,
      status: r.status,
      expiresAt: r.expires_at,
      demonstration: r.demonstration,
    };
  }
  return {
    reconcile,
    validateOperationsReward,
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'rewards') return false;
      if (p[1] !== 'schools' || !p[2] || p.length > 6) throw problem('reward_route_missing', 404);
      const s = services.school(p[2]).schoolId,
        u = (await identity.user(req)).user_id;
      await scope(db, s, u, null);
      const resource = p[3],
        id = p[4],
        action = p[5],
        send = (x) => {
          json(res, 200, x);
          return true;
        };
      if (req.method === 'GET' && resource === 'status') {
        const memberships = (
          await db.pool.query(
            'SELECT m.org_id,m.role FROM hd_org_members m JOIN hd_organizations o USING(school_id,org_id) WHERE m.school_id=$1 AND m.user_id=$2 AND m.active AND o.active',
            [s, u],
          )
        ).rows;
        return send({
          enabled: true,
          partnerConnected: Boolean(issuePartnerEntitlement && revokePartnerEntitlement),
          defaultAwardsEnabled: false,
          appearanceItem: REWARD_ITEM,
          managedOrgIds: memberships.filter((m) => m.role === 'owner').map((m) => m.org_id),
          participationOrgIds: memberships.map((m) => m.org_id),
        });
      }
      if (resource === 'items') {
        if (req.method === 'GET' && !id) {
          const rows = (
              await db.pool.query(
                'SELECT * FROM hd_rewards WHERE school_id=$1 ORDER BY created_at DESC LIMIT 200',
                [s],
              )
            ).rows,
            items = [];
          for (const r of rows) {
            try {
              await allowed(db.pool, s, u, r);
              let canManage = false;
              try {
                await allowed(db.pool, s, u, r, true);
                canManage = true;
              } catch (e) {
                if (e.status !== 403) throw e;
              }
              if (r.status === 'published' || canManage)
                items.push({
                  ...view(r),
                  canManage,
                  available: current(r) && r.allocated < r.stock,
                });
            } catch (e) {
              if (e.status !== 403) throw e;
            }
          }
          return send({ items });
        }
        if (req.method === 'POST' && (!id || action === 'edit')) {
          const b = fields(
            await body(req),
            ['requestId', 'expectedRevision', ...rewardFields],
            'reward',
          );
          return send(
            await mutate(
              s,
              u,
              url.pathname,
              b,
              async (c) =>
                id
                  ? allowed(c, s, u, await row(c, s, id), true)
                  : scope(db, s, u, b.orgId || null, 'manage', c),
              async (c) => {
                const old = id ? await row(c, s, id) : null;
                if (old) {
                  compare(old, b.expectedRevision);
                  if (!['draft', 'rejected'].includes(old.status))
                    throw problem('reward_draft_edit_only', 409);
                  if (old.org_id !== (b.orgId || null))
                    throw problem('reward_scope_immutable', 409);
                }
                if (
                  typeof b.demonstration !== 'boolean' ||
                  !Number.isSafeInteger(b.stock) ||
                  b.stock < 1 ||
                  b.stock > 1000000 ||
                  !Number.isSafeInteger(b.minimumContribution) ||
                  b.minimumContribution < 0 ||
                  b.minimumContribution > 100000000
                )
                  throw problem('reward_invalid');
                const start = new Date(b.startsAt),
                  end = new Date(b.expiresAt);
                if (
                  !Number.isFinite(+start) ||
                  !Number.isFinite(+end) ||
                  end <= start ||
                  end <= new Date()
                )
                  throw problem('reward_time_invalid');
                if (b.contributionPeriod && !validId(b.contributionPeriod))
                  throw problem('reward_period_invalid');
                const t = await target(c, s, u, b.kind, b.target, b.orgId || null),
                  rid = id || randomUUID();
                if (b.kind === 'partner') {
                  const offer = (
                    await c.query(
                      'SELECT valid_until FROM hd_m5_offers WHERE school_id=$1 AND offer_id=$2',
                      [s, t.offerId],
                    )
                  ).rows[0];
                  if (end > offer.valid_until) throw problem('reward_exceeds_offer_expiry');
                }
                await c.query(
                  `INSERT INTO hd_rewards(school_id,reward_id,org_id,creator_id,kind,title,description,target,minimum_contribution,contribution_period,stock,starts_at,expires_at,demonstration,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft') ON CONFLICT(school_id,reward_id) DO UPDATE SET kind=$5,title=$6,description=$7,target=$8,minimum_contribution=$9,contribution_period=$10,stock=$11,starts_at=$12,expires_at=$13,demonstration=$14,status='draft',revision=hd_rewards.revision+1,reviewed_by=NULL,review_reason=NULL,updated_at=now()`,
                  [
                    s,
                    rid,
                    b.orgId || null,
                    u,
                    b.kind,
                    text(b.title, 2, 120),
                    text(b.description, 5, 3000),
                    t,
                    b.minimumContribution,
                    b.contributionPeriod || null,
                    b.stock,
                    start,
                    end,
                    b.demonstration,
                  ],
                );
                const r = await row(c, s, rid);
                await event(c, s, u, r, null, 'draft', r.revision);
                return view(r);
              },
            ),
          );
        }
        if (req.method === 'POST' && id && ['submit', 'review', 'withdraw'].includes(action)) {
          const b = fields(
            await body(req),
            [
              'requestId',
              'expectedRevision',
              ...(action === 'review'
                ? ['decision', 'reason', 'confirmation']
                : action === 'withdraw'
                  ? ['reason']
                  : []),
            ],
            'reward_action',
          );
          return send(
            await mutate(
              s,
              u,
              url.pathname,
              b,
              (c) => row(c, s, id).then((r) => allowed(c, s, u, r, true)),
              async (c) => {
                let r = await row(c, s, id);
                compare(r, b.expectedRevision);
                let state;
                if (action === 'submit') {
                  if (!['draft', 'rejected'].includes(r.status))
                    throw problem('reward_state_conflict', 409);
                  state = 'pending';
                }
                if (action === 'review') {
                  if (r.status !== 'pending' || !['publish', 'reject'].includes(b.decision))
                    throw problem('reward_state_conflict', 409);
                  text(b.reason, 3, 500);
                  state = b.decision === 'publish' ? 'published' : 'rejected';
                  if (state === 'published') {
                    if (
                      b.confirmation !==
                      (r.demonstration ? 'publish-demonstration' : 'publish-real-reward')
                    )
                      throw problem('reward_publication_confirmation_required');
                    if (r.expires_at <= new Date()) throw problem('reward_expired', 409);
                    await target(c, s, u, r.kind, r.target, r.org_id);
                    if (r.kind === 'activity')
                      await c.query(
                        'INSERT INTO hd_reward_activity_gates(school_id,activity_id,item_id,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
                        [s, r.target.activityId, r.target.itemId, u],
                      );
                  }
                }
                if (action === 'withdraw') {
                  if (r.status === 'withdrawn') throw problem('reward_state_conflict', 409);
                  text(b.reason, 3, 500);
                  state = 'withdrawn';
                }
                await c.query(
                  'UPDATE hd_rewards SET status=$3,revision=revision+1,reviewed_by=CASE WHEN $4 THEN $5 ELSE reviewed_by END,review_reason=$6,updated_at=now() WHERE school_id=$1 AND reward_id=$2',
                  [s, id, state, action === 'review', u, b.reason || null],
                );
                r = await row(c, s, id);
                await event(c, s, u, r, null, state, r.revision, { reason: b.reason || null });
                return view(r);
              },
            ),
          );
        }
        if (req.method === 'POST' && id && action === 'claim') {
          const b = fields(
            await body(req),
            ['requestId', 'expectedRevision', 'acceptedTerms', 'acknowledgeDemonstration'],
            'claim',
          );
          return send(
            await mutate(
              s,
              u,
              url.pathname,
              b,
              (c) => row(c, s, id).then((r) => allowed(c, s, u, r)),
              async (c) => {
                const r = await row(c, s, id);
                compare(r, b.expectedRevision);
                if (!current(r)) throw problem('reward_unavailable', 409);
                if (
                  b.acceptedTerms !== true ||
                  (r.demonstration && b.acknowledgeDemonstration !== true)
                )
                  throw problem('reward_terms_consent_required');
                if (
                  (
                    await c.query(
                      'SELECT 1 FROM hd_reward_claims WHERE school_id=$1 AND reward_id=$2 AND user_id=$3',
                      [s, id, u],
                    )
                  ).rowCount
                )
                  throw problem('reward_already_claimed', 409);
                if (r.allocated >= r.stock) throw problem('reward_sold_out', 409);
                const proof = await eligibility(c, s, u, r),
                  claimId = randomUUID();
                await c.query(
                  "INSERT INTO hd_reward_claims(school_id,claim_id,reward_id,user_id,status,eligibility,terms,expires_at) VALUES($1,$2,$3,$4,'reserved',$5,$6,$7)",
                  [
                    s,
                    claimId,
                    id,
                    u,
                    proof,
                    {
                      rewardRevision: r.revision,
                      title: r.title,
                      kind: r.kind,
                      target: r.target,
                      demonstration: r.demonstration,
                      acceptedTerms: true,
                    },
                    r.expires_at,
                  ],
                );
                await c.query(
                  'UPDATE hd_rewards SET allocated=allocated+1 WHERE school_id=$1 AND reward_id=$2',
                  [s, id],
                );
                const claim = await row(c, s, claimId, true);
                await event(c, s, u, r, claim, 'reserved', 1, { eligibility: proof });
                return fulfil(c, s, u, r, claim);
              },
            ),
          );
        }
      }
      if (resource === 'claims') {
        if (req.method === 'GET' && !id) {
          const rows = (
              await db.pool.query(
                'SELECT x.*,r.title,r.kind,r.org_id FROM hd_reward_claims x JOIN hd_rewards r USING(school_id,reward_id) WHERE x.school_id=$1 AND x.user_id=$2 ORDER BY x.created_at DESC',
                [s, u],
              )
            ).rows,
            claims = [];
          for (const x of rows) {
            try {
              await allowed(db.pool, s, u, x);
              claims.push({
                ...view(x),
                effectiveStatus: x.status === 'fulfilled' && !activeClaim(x) ? 'expired' : x.status,
              });
            } catch (e) {
              if (e.status !== 403) throw e;
            }
          }
          return send({ claims });
        }
        if (req.method === 'GET' && id && action === 'history') {
          const x = await row(db.pool, s, id, true),
            r = await row(db.pool, s, x.reward_id);
          await allowed(db.pool, s, u, r, x.user_id !== u);
          return send({
            claim: view(x),
            events: (
              await db.pool.query(
                'SELECT * FROM hd_reward_events WHERE school_id=$1 AND claim_id=$2 ORDER BY revision',
                [s, id],
              )
            ).rows.map(view),
          });
        }
        if (req.method === 'POST' && id && ['retry', 'revoke'].includes(action)) {
          const b = fields(
            await body(req),
            ['requestId', 'expectedRevision', ...(action === 'revoke' ? ['reason'] : [])],
            'claim_action',
          );
          const acl = async (c) => {
            const x = await row(c, s, id, true),
              r = await row(c, s, x.reward_id);
            await allowed(c, s, u, r, action === 'revoke');
            if (action === 'retry' && x.user_id !== u)
              throw problem('own_reward_claim_required', 403);
          };
          return send(
            await mutate(s, u, url.pathname, b, acl, async (c) => {
              const x = await row(c, s, id, true),
                r = await row(c, s, x.reward_id);
              compare(x, b.expectedRevision);
              if (action === 'revoke') {
                text(b.reason, 3, 500);
                return revoke(c, s, u, r, x, b.reason);
              }
              if (x.status !== 'failed') throw problem('reward_retry_not_required', 409);
              return fulfil(c, s, u, r, x);
            }),
          );
        }
      }
      if (req.method === 'GET' && resource === 'manage' && !id) {
        const rows = (
            await db.pool.query(
              'SELECT x.*,r.title,r.kind,r.org_id FROM hd_reward_claims x JOIN hd_rewards r USING(school_id,reward_id) WHERE x.school_id=$1 ORDER BY x.created_at DESC LIMIT 200',
              [s],
            )
          ).rows,
          claims = [];
        for (const x of rows) {
          try {
            await allowed(db.pool, s, u, x, true);
            claims.push(view(x));
          } catch (e) {
            if (e.status !== 403) throw e;
          }
        }
        return send({ claims });
      }
      if (req.method === 'POST' && resource === 'reconcile' && !id) {
        fields(await body(req), [], 'reconcile');
        await scope(db, s, u, null, 'manage');
        return send(await reconcile(s));
      }
      throw problem('reward_route_missing', 404);
    },
  };
}
