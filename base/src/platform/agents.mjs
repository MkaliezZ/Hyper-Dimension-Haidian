import { problem } from './db.mjs';
import { scope } from './permissions.mjs';
import { createModulePolicy } from './modules.mjs';
import { businessAgentId, businessSkills } from './business-a2a.mjs';

const cardSchema = 'hyper-dimension.agent-directory/v1';
const enc = encodeURIComponent;
export function createAgentDirectory(
  db,
  identity,
  services,
  config,
  { getWorld = () => null, getPartnerSources } = {},
) {
  const modules = createModulePolicy(config);
  async function directory(schoolId, userId) {
    const school = services.school(schoolId),
      enabled = modules.forSchool(schoolId);
    return db.tx(async (c) => {
      // The response is a current projection, serialized with permission and publication changes.
      for (const key of [schoolId + ':permissions', schoolId + ':information'])
        await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [key]);
      await scope(db, schoolId, userId, null, 'read', c);
      const cards = [],
        pack = getWorld()?.packFor(school.spaceId);
      const schoolResponsible = Boolean(
        (
          await c.query(
            "SELECT 1 FROM hd_memberships m JOIN hd_users u USING(user_id) WHERE m.school_id=$1 AND m.role='owner' AND m.active AND u.enabled LIMIT 1",
            [schoolId],
          )
        ).rowCount,
      );
      const maintained = async (orgId) => {
        const org = orgId
          ? (
              await c.query(
                'SELECT name FROM hd_organizations WHERE school_id=$1 AND org_id=$2 AND active',
                [schoolId, orgId],
              )
            ).rows[0]
          : null;
        const organizationResponsible = orgId
          ? Boolean(
              (
                await c.query(
                  "SELECT 1 FROM hd_org_members m JOIN hd_memberships s USING(school_id,user_id) JOIN hd_users u USING(user_id) WHERE m.school_id=$1 AND m.org_id=$2 AND m.role='owner' AND m.active AND s.active AND u.enabled LIMIT 1",
                  [schoolId, orgId],
                )
              ).rowCount,
            )
          : false;
        return {
          role: orgId ? 'organization-owner' : 'school-owner',
          label: orgId ? `${org?.name || '本组织'}负责人` : '学校负责人',
          assigned: orgId ? organizationResponsible : schoolResponsible,
          schoolEscalationAvailable: schoolResponsible,
          entryUrl:
            '/m1.html?school=' + enc(schoolId) + (orgId ? '&organization=' + enc(orgId) : ''),
        };
      };
      const base = (id, kind, name, orgId, maintainer) => ({
        schema: cardSchema,
        id,
        schoolId,
        spaceId: school.spaceId,
        orgId: orgId || null,
        kind,
        name,
        maintainer,
        privateInformationAccess: false,
        authorityEscalation: false,
        rewardIssuance: false,
        delegatedExecution: false,
      });
      for (const agent of pack?.agents || []) {
        const skills = agent.skills.filter((s) =>
          ['space.information', 'navigation.route', 'message.leave'].includes(s),
        );
        if (!skills.length) continue;
        cards.push({
          ...base(
            'reception:' + agent.agentId,
            'reception-agent',
            agent.name,
            null,
            await maintained(null),
          ),
          description: agent.description || '学校空间接待，回答已发布资料并提供空间导航。',
          protocol: 'A2A/1.0',
          agentId: agent.agentId,
          agentCardUrl: '/agents/' + enc(agent.agentId) + '/.well-known/agent-card.json',
          capabilities: skills.map((id) => ({
            id,
            mode: id === 'message.leave' ? 'user-requested-message' : 'scoped-query',
            requiresUserAction: true,
          })),
          sources: [{ kind: 'space-package', id: pack.spaceId, revision: pack.baseVersion }],
          answerBasis: [
            'published-space-information',
            'reviewed-partner-information',
            'labeled-general-conversation-if-configured',
          ],
          actions: [
            {
              label: '进入空间向接待提问',
              href: '/?space=' + enc(school.spaceId),
              confirmation: '提问由用户发送；留言须主动选择给维护者留言。',
            },
          ],
        });
      }
      if (enabled.base3) {
        const rows = (
          await c.query(
            "SELECT activity_id,org_id,title,description,status,revision,starts_at,ends_at FROM hd_activities WHERE school_id=$1 AND status='published' AND ends_at>now() ORDER BY starts_at,activity_id",
            [schoolId],
          )
        ).rows;
        for (const a of rows) {
          try {
            await scope(db, schoolId, userId, a.org_id, 'read', c);
          } catch (e) {
            if (e.status === 403) continue;
            throw e;
          }
          cards.push({
            ...base(
              'activity:' + a.activity_id,
              'activity-workflow',
              a.title + ' · 活动助理',
              a.org_id,
              await maintained(a.org_id),
            ),
            description: a.description,
            protocol: 'Base authenticated workflow',
            capabilities: [
              {
                id: 'activity.read',
                mode: 'scoped-query',
                endpoint: '/activities/schools/' + enc(schoolId) + '/items/' + a.activity_id,
              },
              {
                id: 'activity.participation',
                mode: 'explicit-user-workflow',
                requiresUserAction: true,
              },
            ],
            sources: [
              {
                kind: 'published-activity',
                id: a.activity_id,
                revision: a.revision,
                validUntil: a.ends_at,
              },
            ],
            answerBasis: ['reviewed-activity'],
            actions: [
              {
                label: '查看安排并自行报名',
                href:
                  '/activities.html?school=' +
                  enc(schoolId) +
                  (a.org_id ? '&organization=' + enc(a.org_id) : '') +
                  '&activity=' +
                  a.activity_id,
                confirmation: '查看资格、时间和分工后自行确认报名；助理不会替你报名或核验。',
              },
            ],
          });
        }
      }
      if (enabled.base4 && getPartnerSources) {
        const sources = await getPartnerSources(schoolId, c);
        for (const source of sources) {
          const partner = (
            await c.query(
              "SELECT partner_id,name,org_id FROM hd_m5_partners WHERE school_id=$1 AND partner_id=$2 AND status='approved' AND valid_until>now()",
              [schoolId, source.partnerId],
            )
          ).rows[0];
          if (!partner) continue;
          try {
            await scope(db, schoolId, userId, null, 'read', c);
          } catch (e) {
            if (e.status === 403) continue;
            throw e;
          }
          const assigned = Boolean(
            (
              await c.query(
                "SELECT 1 FROM hd_m5_staff t JOIN hd_memberships m USING(school_id,user_id) JOIN hd_users u USING(user_id) WHERE t.school_id=$1 AND t.partner_id=$2 AND t.role='maintainer' AND t.active AND m.active AND u.enabled LIMIT 1",
                [schoolId, partner.partner_id],
              )
            ).rowCount,
          );
          cards.push({
            ...base(
              'partner:' + source.serviceId,
              'partner-business-agent',
              source.title + ' · 合作服务助理',
              partner.org_id,
              {
                role: 'partner-maintainer',
                label: partner.name + '的服务维护者',
                assigned,
                schoolEscalationAvailable: schoolResponsible,
                entryUrl: '/partners.html?school=' + enc(schoolId),
              },
            ),
            description: source.text,
            protocol: 'A2A 1.0 JSONRPC',
            delegatedExecution: true,
            privateInformationAccess: true,
            privateInformationScope: 'explicitly-delegated-own-business-tasks',
            agentCardUrl:
              '/agents/' + businessAgentId(school.spaceId) + '/.well-known/agent-card.json',
            capabilities: businessSkills.map((id) => ({
              id,
              mode: 'explicit-scoped-delegation',
              requiresDelegation: true,
              serviceId: source.serviceId,
            })),
            humanActions: [
              {
                id: 'partner.service.read',
                mode: 'scoped-query',
                endpoint: '/m5/schools/' + enc(schoolId) + '/directory',
              },
              {
                id: 'partner.request.propose',
                mode: 'explicit-user-workflow',
                requiresUserAction: true,
              },
            ],
            sources: [
              {
                kind: 'reviewed-partner-service',
                id: source.serviceId,
                partnerId: source.partnerId,
                revision: source.revision,
                validUntil: source.validUntil,
              },
            ],
            answerBasis: ['reviewed-partner-information'],
            actions: [
              {
                label: '授权本地 Agent',
                href:
                  '/delegations.html?school=' + enc(schoolId) + '&service=' + enc(source.serviceId),
                confirmation: '逐项选择服务、操作和期限；创建申请后仍需本人确认资料转交。',
              },
              {
                label: '核对服务并确认申请',
                href:
                  '/partners.html?school=' + enc(schoolId) + '&service=' + enc(source.serviceId),
                confirmation:
                  '先阅读服务条件，再明确选择转交对象和字段并确认。未配置外部适配器时显示不可用，不声称已预约成功。',
              },
            ],
          });
        }
      }
      return {
        schema: cardSchema,
        schoolId,
        spaceId: school.spaceId,
        checkedAt: new Date().toISOString(),
        modules: enabled,
        cards,
      };
    });
  }
  return {
    directory,
    async handle(req, res, { url, json }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (p[0] !== 'agent-directory') return false;
      if (req.method !== 'GET') throw problem('agent_directory_read_only', 405);
      if (p[1] !== 'schools' || !p[2] || !(p.length === 3 || (p.length === 5 && p[3] === 'cards')))
        throw problem('agent_directory_route_missing', 404);
      const school = services.school(p[2]).schoolId,
        user = (await identity.user(req)).user_id;
      const result = await directory(school, user);
      if (p.length === 5) {
        let id;
        try {
          id = decodeURIComponent(p[4]);
        } catch {
          throw problem('agent_card_id_invalid');
        }
        const card = result.cards.find((card) => card.id === id);
        if (!card) throw problem('agent_card_unavailable', 404);
        json(res, 200, { ...card, checkedAt: result.checkedAt });
      } else json(res, 200, result);
      return true;
    },
  };
}
