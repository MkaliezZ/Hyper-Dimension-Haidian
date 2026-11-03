import { randomUUID, randomBytes } from 'node:crypto';
import { hash, problem } from './db.mjs';
import { fields } from '../protocol/index.mjs';
import { createModulePolicy } from './modules.mjs';
import { audit } from './permissions.mjs';

export const businessSkills = [
  'partner.services.list',
  'partner.service.get',
  'partner.task.propose',
  'partner.task.get',
  'partner.task.cancel',
];
export const businessAgentId = (spaceId) => spaceId + '-partner-services';
const publicGrant = (g) => ({
  delegationId: g.delegation_id,
  schoolId: g.school_id,
  label: g.label,
  serviceIds: g.service_ids,
  skills: g.skills,
  expiresAt: g.expires_at,
  revokedAt: g.revoked_at,
});
export function createBusinessA2A(db, identity, services, config, partners) {
  const policy = createModulePolicy(config),
    business = partners.business;
  async function active(id, c = db.pool) {
    const g = (
      await c.query(
        'SELECT * FROM hd_agent_delegations WHERE delegation_id=$1 AND revoked_at IS NULL AND expires_at>now()',
        [id],
      )
    ).rows[0];
    if (!g) throw problem('agent_delegation_unavailable', 403);
    if (!policy.forSchool(g.school_id).base4) throw problem('module_disabled', 409);
    const m = await db.member(g.school_id, g.user_id, null, c);
    if (['partner', 'affiliate'].includes(m.role)) throw problem('school_member_required', 403);
    return g;
  }
  async function principal(req) {
    if (
      !/^\/agents\/[^/]+\/(a2a|\.well-known\/agent-card\.json)$/.test(
        new URL(req.url, 'http://base.invalid').pathname,
      )
    )
      throw problem('agent_token_business_routes_only', 403);
    const token = req.headers.authorization?.match(/^Bearer (hd_ag_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw problem('invalid_agent_token', 401);
    const g = (
      await db.pool.query('SELECT delegation_id FROM hd_agent_delegations WHERE token_hash=$1', [
        hash(token),
      ])
    ).rows[0];
    if (!g) throw problem('invalid_agent_token', 401);
    const current = await active(g.delegation_id);
    return {
      id: 'delegation:' + current.delegation_id,
      tenantBound: true,
      spaces: [services.school(current.school_id).spaceId],
      scopes: ['public:read', 'a2a:call'],
      allowedAgents: [businessAgentId(services.school(current.school_id).spaceId)],
      delegationId: current.delegation_id,
    };
  }
  async function check(ctx, c = db.pool) {
    if (!ctx.principal.delegationId) throw problem('explicit_agent_delegation_required', 403);
    const g = await active(ctx.principal.delegationId, c);
    if (
      ctx.principal.id !== 'delegation:' + g.delegation_id ||
      services.school(g.school_id).spaceId !== ctx.pack.spaceId ||
      !g.skills.includes(ctx.skillId)
    )
      throw problem('agent_scope_denied', 403);
    const args = ctx.arguments || {};
    let serviceId = args.serviceId;
    if (args.taskId) {
      const t = await business.taskOwner(c, g.school_id, g.user_id, args.taskId);
      serviceId = t.service_id;
    }
    if (serviceId && !g.service_ids.includes(serviceId)) throw problem('agent_service_denied', 403);
    if (['partner.service.get', 'partner.task.propose'].includes(ctx.skillId))
      await business.publicService(c, g.school_id, serviceId);
    // Replays cannot disclose a cached source after review, withdrawal, expiry or revision change.
    for (const source of ctx.result?.sources || []) {
      if (!g.service_ids.includes(source.serviceId)) throw problem('agent_service_denied', 403);
      const s = await business.publicService(c, g.school_id, source.serviceId);
      if (s.revision !== source.revision)
        throw problem('agent_source_changed_new_request_required', 409);
    }
    return g;
  }
  const capabilities = Object.fromEntries(
    businessSkills.map((skillId) => [
      skillId,
      {
        authorize: (ctx) => check({ ...ctx, skillId }),
        async execute(ctx) {
          const context = { ...ctx, skillId },
            g = await check(context);
          const args = ctx.arguments || {};
          const guard = (c) => check(context, c);
          guard.delegationId = g.delegation_id;
          let result,
            sources = [];
          if (skillId === 'partner.services.list' || skillId === 'partner.service.get') {
            fields(args, skillId.endsWith('.get') ? ['serviceId'] : [], 'business arguments');
            sources = (await partners.publishedSources(g.school_id)).filter(
              (s) =>
                g.service_ids.includes(s.serviceId) &&
                (!args.serviceId || s.serviceId === args.serviceId),
            );
            if (skillId === 'partner.services.list')
              sources = sources.map(
                ({ id, title, serviceId, partnerId, revision, validUntil }) => ({
                  id,
                  title,
                  serviceId,
                  partnerId,
                  revision,
                  validUntil,
                }),
              );
            result = { services: sources };
          } else if (skillId === 'partner.task.propose') {
            fields(args, ['requestId', 'serviceId', 'kind', 'request'], 'business arguments');
            result = await business.proposeTask(g.school_id, g.user_id, args, guard);
            result.confirmUrl =
              '/partners.html?school=' + encodeURIComponent(g.school_id) + '&task=' + result.taskId;
          } else if (skillId === 'partner.task.get') {
            fields(args, ['taskId'], 'business arguments');
            result = business.view(
              await business.taskOwner(db.pool, g.school_id, g.user_id, args.taskId),
            );
          } else {
            fields(
              args,
              ['taskId', 'requestId', 'expectedRevision', 'reason'],
              'business arguments',
            );
            const { taskId, ...input } = args;
            result = await business.cancelTask(g.school_id, g.user_id, taskId, input, guard);
          }
          await check({ ...context, result: { sources } });
          return {
            text: JSON.stringify(result),
            data: result,
            sources,
            mode: 'delegated-partner-business',
            onBehalfOf: g.user_id,
            delegationId: g.delegation_id,
          };
        },
      },
    ]),
  );
  return {
    principal,
    capabilities,
    augmentPacks(packs) {
      return packs.map((pack) => {
        const next = {
          ...pack,
          agents: [
            ...pack.agents,
            {
              agentId: businessAgentId(pack.spaceId),
              name: '合作服务 Agent',
              description:
                '受学校、服务和用户明确授权约束的合作服务查询与业务委托；个人资料转交仍须人确认。',
              skills: businessSkills,
            },
          ],
        };
        if (pack.packageRoot)
          Object.defineProperty(next, 'packageRoot', { value: pack.packageRoot });
        return next;
      });
    },
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'agent-business') return false;
      if (p[1] !== 'schools' || p[3] !== 'delegations') throw problem('route_missing', 404);
      const school = services.school(p[2]).schoolId,
        user = (await identity.user(req)).user_id;
      await db.member(school, user);
      if (req.method === 'GET' && !p[4]) {
        json(res, 200, {
          delegations: (
            await db.pool.query(
              'SELECT * FROM hd_agent_delegations WHERE school_id=$1 AND user_id=$2 ORDER BY created_at DESC',
              [school, user],
            )
          ).rows.map(publicGrant),
        });
        return true;
      }
      if (req.method !== 'POST' || (p[4] && p[5] !== 'revoke') || p.length > 6)
        throw problem('method_denied', 405);
      const input = fields(
        await body(req),
        p[5] === 'revoke'
          ? ['requestId']
          : ['requestId', 'label', 'serviceIds', 'skills', 'expiresAt', 'confirmed'],
        'delegation',
      );
      let token;
      const result = await db.receipt(
        school,
        user,
        input.requestId,
        { route: url.pathname, input },
        async (c) => {
          if (p[5] === 'revoke') {
            const g = (
              await c.query(
                'UPDATE hd_agent_delegations SET revoked_at=coalesce(revoked_at,now()) WHERE school_id=$1 AND user_id=$2 AND delegation_id=$3 RETURNING *',
                [school, user, p[4]],
              )
            ).rows[0];
            if (!g) throw problem('delegation_missing', 404);
            await audit(c, school, user, 'agent.delegation.revoked', g.delegation_id, {});
            return publicGrant(g);
          }
          if (req.method !== 'POST' || p[4]) throw problem('method_denied', 405);
          if (!policy.forSchool(school).base4) throw problem('module_disabled', 409);
          if (
            input.confirmed !== true ||
            typeof input.label !== 'string' ||
            input.label.length < 2 ||
            input.label.length > 100 ||
            !Array.isArray(input.serviceIds) ||
            !input.serviceIds.length ||
            input.serviceIds.length > 50 ||
            !Array.isArray(input.skills) ||
            !input.skills.length ||
            input.skills.length > businessSkills.length ||
            input.skills.some((x) => !businessSkills.includes(x))
          )
            throw problem('explicit_scoped_delegation_required');
          const expiry = Date.parse(input.expiresAt);
          if (
            !Number.isFinite(expiry) ||
            expiry <= Date.now() ||
            expiry > Date.now() + 86400000 * 7
          )
            throw problem('delegation_expiry_max_7_days');
          const m = await db.member(school, user, null, c);
          if (['partner', 'affiliate'].includes(m.role))
            throw problem('school_member_required', 403);
          for (const id of input.serviceIds) await business.publicService(c, school, id);
          token = 'hd_ag_' + randomBytes(32).toString('base64url');
          const id = randomUUID();
          const g = (
            await c.query(
              'INSERT INTO hd_agent_delegations(delegation_id,school_id,user_id,token_hash,label,service_ids,skills,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
              [
                id,
                school,
                user,
                hash(token),
                input.label,
                [...new Set(input.serviceIds)],
                [...new Set(input.skills)],
                new Date(expiry),
              ],
            )
          ).rows[0];
          await audit(c, school, user, 'agent.delegation.created', id, {
            serviceIds: g.service_ids,
            skills: g.skills,
            expiresAt: g.expires_at,
          });
          return publicGrant(g);
        },
      );
      // Never store the bearer secret in receipts, audits, browser storage or queue payloads.
      json(res, 200, { ...result, ...(token ? { token } : { tokenNotRepeated: true }) });
      return true;
    },
  };
}
