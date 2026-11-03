import { openPlatform, problem } from './db.mjs';
import { createIdentity } from './identity.mjs';
import { createServices } from './services.mjs';
import { applyForumEvent, drainOutbox } from './ledger.mjs';
import { catalog, defaultRecipe, validateRecipe, avatarGlb, modelHash } from '../avatar/model.mjs';
import { fields } from '../protocol/index.mjs';
import { createM1 } from './m1.mjs';
import { scope } from './permissions.mjs';
import { reconcileSchool, reconcileSteps } from './reconcile.mjs';
import { openPgStore } from './pg-store.mjs';
import { createChat } from './chat.mjs';
import { createM2 } from './m2.mjs';
import { createInformation } from './information.mjs';
import { createPersonal } from './personal.mjs';
import { createPartners } from './partners.mjs';
import { createActivities } from './activities.mjs';
import { createJobs } from './jobs.mjs';
import { createAttachments } from './attachments.mjs';
import { createContacts } from './contacts.mjs';
import { createCommunity } from './community.mjs';
import { createCampusLedger } from './campus-ledger.mjs';
import { createRewards } from './rewards.mjs';
import { createOperations } from './operations.mjs';
import { createModulePolicy } from './modules.mjs';
import { createEnvironment } from './environment.mjs';
import { createJobAdmin } from './job-admin.mjs';
import { createAgentDirectory } from './agents.mjs';
import { createBusinessA2A } from './business-a2a.mjs';
import { createIndexing } from './indexing.mjs';
import { createAnnual } from './annual.mjs';
import { createReceptionAdmin } from './reception-admin.mjs';
import { createNetwork } from './network.mjs';
export async function createPlatform(config) {
  const modules = createModulePolicy(config);
  const m1 = config.milestone === 'M1';
  const db = await openPlatform(config.databaseUrl, { m1 }),
    identity = createIdentity(db, config),
    services = createServices(db, config);
  db.campusEnabled = Boolean(config.campusEnabled);
  const campusLedger =
    m1 && config.campusEnabled ? createCampusLedger(db, identity, services, config) : null;
  if (campusLedger) db.recordCampusContribution = campusLedger.recordContribution;
  for (const s of config.schools)
    await db.pool.query('INSERT INTO hd_schools VALUES($1,$2) ON CONFLICT DO NOTHING', [
      s.schoolId,
      s.spaceId,
    ]);
  let store, world, activities, community, indexing;
  const attachments =
    m1 && config.campusEnabled
      ? createAttachments(db, identity, services, {
          canReadLinked: async (c, ref) => {
            if (ref.purpose === 'activity-evidence')
              return (
                activities?.canReadAttachment(c, { ...ref, activityId: ref.targetId }) || false
              );
            if (ref.purpose === 'community')
              return community?.canReadAttachment(c, { ...ref, sourceId: ref.targetId }) || false;
            return false;
          },
        })
      : null;
  const contacts = m1 && config.campusEnabled ? createContacts(db, identity, services) : null;
  community =
    m1 && config.campusEnabled
      ? createCommunity(db, identity, services, config, {
          getWorld: () => world,
          validateAttachment: attachments.validateAttachment,
        })
      : null;
  const jobs =
    m1 && config.campusEnabled
      ? await createJobs(config, {
          handlers: {
            'forum-index': (data) => indexing.workForum(data),
            'knowledge-index': (data) => indexing.workPublic(data),
            'activity-reminder': async (data) => {
              if (!activities) throw problem('activity_module_unavailable', 503);
              return activities.reconcile(data.schoolId);
            },
          },
        })
      : null;
  indexing = jobs ? createIndexing(db, identity, services, config, jobs) : null;
  activities =
    m1 && config.campusEnabled
      ? createActivities(db, identity, services, config, {
          getWorld: () => world,
          scheduleReminder: jobs.scheduleReminder,
          validateAttachment: attachments.validateAttachment,
          recordContribution: campusLedger.recordContribution,
        })
      : null;
  const m2Handle =
    m1 && config.m2Enabled
      ? createM2(db, identity, services, config, { getStore: () => store, getWorld: () => world })
      : null;
  const chat = m1 ? createChat(db, identity, services, config) : null;
  const information = m1 && config.campusEnabled ? createInformation(db, identity, services) : null;
  const personal =
    m1 && config.campusEnabled ? createPersonal(db, identity, services, config) : null;
  const partners =
    m1 && config.partnersEnabled
      ? createPartners(db, identity, services, config, { getWorld: () => world })
      : null;
  const rewards =
    m1 && config.campusEnabled
      ? createRewards(db, identity, services, config, {
          issuePartnerEntitlement: partners?.issueReward,
          revokePartnerEntitlement: partners?.revokeReward,
        })
      : null;
  const businessA2A =
    partners && config.campusEnabled
      ? createBusinessA2A(db, identity, services, config, partners)
      : null;
  if (businessA2A) db.agentPrincipal = businessA2A.principal;
  const operations =
    m1 && config.campusEnabled
      ? createOperations(db, identity, services, config, {
          createActivityDraft: activities.createDraft,
          validateReward: rewards.validateOperationsReward,
        })
      : null;
  const annual =
    m1 && config.campusEnabled
      ? createAnnual(db, identity, services, {
          createActivityDraft: activities.createDraft,
          modulePolicy: modules,
        })
      : null;
  const environment =
    m1 && config.campusEnabled
      ? createEnvironment(db, identity, services, config, { getWorld: () => world })
      : null;
  const receptionAdmin =
    m1 && config.campusEnabled
      ? createReceptionAdmin(db, identity, services, {
          getSessions: () => world?.receptionSessions,
        })
      : null;
  const network =
    m1 && config.campusEnabled
      ? createNetwork(db, identity, services, { getWorld: () => world, modulePolicy: modules })
      : null;
  const jobAdmin = jobs ? createJobAdmin(db, identity, services, jobs, config) : null;
  const agents =
    m1 && config.campusEnabled
      ? createAgentDirectory(db, identity, services, config, {
          getWorld: () => world,
          getPartnerSources: partners?.publishedSources,
        })
      : null;
  const extensions = [
    ...(m1 ? ['m1'] : []),
    ...(m2Handle ? ['m2'] : []),
    ...(information ? ['campus'] : []),
    ...(partners ? ['partners'] : []),
    ...(activities ? ['activities'] : []),
    ...(campusLedger ? ['ledger'] : []),
    ...(rewards ? ['rewards'] : []),
    ...(operations ? ['operations'] : []),
    ...(annual ? ['annual'] : []),
    ...(community ? ['community'] : []),
    ...(contacts ? ['contacts'] : []),
    ...(environment ? ['environment'] : []),
    ...(network ? ['network', 'reception-sessions'] : []),
  ];
  const reconcile = (id) => reconcileSchool(db, services, services.school(id));
  if (agents) extensions.push('agents');
  if (jobAdmin) extensions.push('jobs');
  const m1Handle = m1
    ? createM1(db, identity, services, config, { reconcile, getStore: () => store })
    : null;
  let syncing = false;
  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const steps = [];
      const step = (schoolId, stage, run) => steps.push({ schoolId, stage, run });
      for (const s of config.schools) {
        if (m1) {
          step(s.schoolId, 'chat', async () => {
            const result = await chat.reconcile(s.schoolId);
            if (result.blocked.length) throw problem('chat_original_request_retry_required', 503);
          });
          if (config.chatRetentionDays)
            step(s.schoolId, 'chat-expiry', () => chat.expire(s.schoolId, { apply: true }));
          if (attachments) step(s.schoolId, 'attachments', () => attachments.expire(s.schoolId));
          if (partners) step(s.schoolId, 'partners', () => partners.reconcile(s.schoolId));
          if (rewards) step(s.schoolId, 'rewards', () => rewards.reconcile(s.schoolId));
          step(s.schoolId, 'forum', async () => {
            const result = await reconcile(s.schoolId);
            if (result.blocked?.length) throw problem('source_reconciliation_blocked', 503);
          });
          if (indexing) step(s.schoolId, 'indexing', () => indexing.reconcile(s.schoolId));
          continue;
        }
        step(s.schoolId, 'forum', async () => {
          const { events } = await services.forum(s, 'events', {});
          for (const e of events) await applyForumEvent(db, s.schoolId, e);
        });
      }
      step(null, 'score-projection', () => drainOutbox(db, (row) => services.project(row)));
      await reconcileSteps(steps);
    } finally {
      syncing = false;
    }
  }
  let lastSyncError = null,
    lastSyncAt = null;
  const timer = setInterval(
    () =>
      sync()
        .then(() => {
          lastSyncError = null;
          lastSyncAt = new Date().toISOString();
        })
        .catch((e) => {
          lastSyncError = e.code || e.message;
        }),
    3000,
  );
  timer.unref();
  return {
    db,
    identity,
    services,
    extensions,
    capabilities: businessA2A?.capabilities || {},
    bindKnowledge: (k) => indexing?.bind(k),
    augmentPacks: (packs) => (businessA2A ? businessA2A.augmentPacks(packs) : packs),
    async publishedSources(spaceId) {
      const s = config.schools.find((s) => s.spaceId === spaceId);
      if (!s || !partners || !modules.forSchool(s.schoolId).base4) return [];
      return partners.publishedSources(s.schoolId);
    },
    bindWorld: (context) => {
      world = context;
    },
    sync,
    stopStreams: () => chat?.close(),
    ...(m1
      ? {
          async openStore(directory) {
            store = await openPgStore(db, directory);
            return store;
          },
        }
      : {}),
    async handle(req, res, { url, json, body }) {
      if (await identity.handle(req, res, url)) return true;
      modules.guard(req, url);
      if (receptionAdmin && (await receptionAdmin(req, res, { url, json, body }))) return true;
      if (network && (await network(req, res, { url, json, body }))) return true;
      if (indexing && (await indexing.handle(req, res, { url, json, body }))) return true;
      if (businessA2A && (await businessA2A.handle(req, res, { url, json, body }))) return true;
      if (agents && (await agents.handle(req, res, { url, json, body }))) return true;
      if (jobAdmin && (await jobAdmin.handle(req, res, { url, json, body }))) return true;
      if (environment && (await environment.handle(req, res, { url, json, body }))) return true;
      if (campusLedger && (await campusLedger.handle(req, res, { url, json, body }))) return true;
      if (rewards && (await rewards.handle(req, res, { url, json, body }))) return true;
      if (operations && (await operations.handle(req, res, { url, json, body }))) return true;
      if (annual && (await annual.handle(req, res, { url, json, body }))) return true;
      if (contacts && (await contacts(req, res, { url, json, body }))) return true;
      if (community && (await community(req, res, { url, json, body }))) return true;
      if (attachments && (await attachments.handle(req, res, { url, json, body }))) return true;
      if (activities && (await activities.handle(req, res, { url, json, body }))) return true;
      if (information && (await information(req, res, { url, json, body }))) return true;
      if (personal && (await personal(req, res, { url, json, body }))) return true;
      if (partners && (await partners.handle(req, res, { url, json, body }))) return true;
      if (m2Handle && (await m2Handle(req, res, { url, json, body }))) return true;
      if (chat && (await chat.handle(req, res, { url, json, body }))) return true;
      if (m1Handle && (await m1Handle(req, res, { url, json, body }))) return true;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'm0') return false;
      if (parts[1] === 'internal') {
        const purpose = parts[2] === 'nakama' ? 'nakama' : 'forum',
          s = services.service(req, purpose),
          input = await body(req);
        if (req.method !== 'POST') throw problem('method_denied', 405);
        if (m1 && parts[3] === 'status') {
          json(res, 200, {
            schoolId: s.schoolId,
            syncHealthy: !lastSyncError,
            checkedAt: lastSyncAt,
          });
          return true;
        }
        if (parts[3] === 'ticket') {
          json(res, 200, await services.consume(s, input.ticket, purpose));
          return true;
        }
        if (parts[3] === 'member') {
          const m =
            m1 && purpose === 'forum' && input.action
              ? await scope(
                  db,
                  s.schoolId,
                  input.userId,
                  input.orgId,
                  input.action === 'moderate' ? 'moderate' : 'read',
                )
              : await db.member(s.schoolId, input.userId);
          json(res, 200, {
            userId: input.userId,
            schoolId: s.schoolId,
            role: m.role,
            revision: m.revision,
            campusEnabled: Boolean(config.campusEnabled),
          });
          return true;
        }
        throw problem('route_missing', 404);
      }
      const u = await identity.user(req);
      if (parts[1] === 'me' && req.method === 'GET') {
        const { rows } = await db.pool.query(
          `SELECT s.*,m.role,m.revision FROM hd_memberships m JOIN hd_schools s USING(school_id)
           WHERE user_id=$1 AND active AND s.school_id=ANY($2::text[]) ORDER BY school_id`,
          [u.user_id, config.schools.map((s) => s.schoolId)],
        );
        json(res, 200, {
          userId: u.user_id,
          name: u.display_name,
          schools: rows.map((s) => ({ ...s, modules: modules.forSchool(s.school_id) })),
          syncHealthy: !lastSyncError,
          extensions,
        });
        return true;
      }
      if (parts[1] !== 'schools' || !parts[2]) throw problem('route_missing', 404);
      const s = services.school(parts[2]),
        m = await db.member(s.schoolId, u.user_id);
      if (url.searchParams.has('userId') && url.searchParams.get('userId') !== u.user_id)
        throw problem('other_user_denied', 403);
      const action = parts[3];
      if (m1 && ['partner', 'affiliate'].includes(m.role))
        throw problem('organization_route_required', 403);
      if (action === 'identities' && req.method === 'POST') {
        const social = await services.social(s, u.user_id);
        const t = await services.ticket(s.schoolId, u.user_id, 'forum');
        const forum = await services.forum(s, 'bind', { ticket: t });
        await services.mapping(s.schoolId, u.user_id, 'nodebb', forum.uid);
        json(res, 200, { userId: u.user_id, nakamaId: social.nakamaId, forumUid: forum.uid });
        return true;
      }
      if (action === 'social' && req.method === 'POST') {
        json(res, 200, await services.social(s, u.user_id));
        return true;
      }
      if (action === 'forum-login' && req.method === 'GET') {
        const t = await services.ticket(s.schoolId, u.user_id, 'forum');
        res.writeHead(302, {
          Location: s.forumUrl + '/api/hd/login?ticket=' + encodeURIComponent(t),
        });
        res.end();
        return true;
      }
      if (action === 'avatar') {
        if (parts[4] === 'catalog' && req.method === 'GET') {
          json(res, 200, { catalog, defaultRecipe });
          return true;
        }
        if (parts[4] === 'preview' && req.method === 'POST') {
          const r = validateRecipe(await body(req)),
            buffer = avatarGlb(r);
          res.writeHead(200, {
            'Content-Type': 'model/gltf-binary',
            'Content-Length': buffer.length,
            'Cache-Control': 'no-store',
          });
          res.end(buffer);
          return true;
        }
        if (req.method === 'GET') {
          const {
            rows: [a],
          } = await db.pool.query('SELECT * FROM hd_avatars WHERE school_id=$1 AND user_id=$2', [
            s.schoolId,
            u.user_id,
          ]);
          if (parts[4] === 'model.glb') {
            const buffer = avatarGlb(a?.recipe || defaultRecipe);
            if (a && modelHash(a.recipe) !== a.model_hash)
              throw problem('avatar_rebuild_mismatch', 409);
            if (
              url.searchParams.has('hash') &&
              url.searchParams.get('hash') !== (a?.model_hash || modelHash(defaultRecipe))
            )
              throw problem('avatar_version_changed', 409);
            res.writeHead(200, {
              'Content-Type': 'model/gltf-binary',
              'Cache-Control': 'no-store',
            });
            res.end(buffer);
          } else if (parts.length === 4)
            json(
              res,
              200,
              a
                ? { recipe: a.recipe, version: a.version, modelHash: a.model_hash }
                : { recipe: defaultRecipe, version: 0, modelHash: modelHash(defaultRecipe) },
            );
          else throw problem('route_missing', 404);
          return true;
        }
        if (req.method === 'PUT' && parts.length === 4) {
          const input = fields(
              await body(req),
              ['requestId', 'expectedVersion', 'recipe'],
              'avatar',
            ),
            r = validateRecipe(input.recipe);
          if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
            throw problem('avatar_version_required');
          const result = await db.receipt(
            s.schoolId,
            u.user_id,
            input.requestId,
            input,
            async (c) => {
              await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                s.schoolId + ':avatar:' + u.user_id,
              ]);
              const {
                rows: [old],
              } = await c.query(
                'SELECT version FROM hd_avatars WHERE school_id=$1 AND user_id=$2',
                [s.schoolId, u.user_id],
              );
              if ((old?.version || 0) !== input.expectedVersion)
                throw problem('avatar_write_conflict', 409);
              const h = modelHash(r),
                v = input.expectedVersion + 1;
              await c.query(
                `INSERT INTO hd_avatars(school_id,user_id,version,recipe,model_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,user_id)
              DO UPDATE SET version=EXCLUDED.version,recipe=EXCLUDED.recipe,model_hash=EXCLUDED.model_hash,updated_at=now()`,
                [s.schoolId, u.user_id, v, r, h],
              );
              return { version: v, recipe: r, modelHash: h };
            },
          );
          json(res, 200, result);
          return true;
        }
      }
      if (action === 'forum') {
        if (req.method === 'GET') {
          if (parts[4] === 'posting-state') {
            json(res, 200, await services.forum(s, 'posting-state', { userId: u.user_id }));
            return true;
          }
          if (parts.length !== 4) throw problem('route_missing', 404);
          json(res, 200, await services.forum(s, 'list', { userId: u.user_id }));
          return true;
        }
        if (req.method === 'POST') {
          const input = fields(
            await body(req),
            ['action', 'requestId', 'id', 'title', 'content'],
            'forum',
          );
          if (!['submit', 'approve', 'withdraw'].includes(input.action))
            throw problem('forum_action_invalid');
          if (input.action !== 'submit' && !['moderator', 'owner'].includes(m.role))
            throw problem('moderation_denied', 403);
          // Source validates actor again. Only allowlist user fields leave Base.
          const result = await services.forum(s, input.action, {
            userId: u.user_id,
            requestId: input.requestId,
            id: input.id,
            title: input.title,
            content: input.content,
          });
          await sync();
          json(res, 200, result);
          return true;
        }
      }
      if (action === 'ranking' && req.method === 'GET') {
        if (config.campusEnabled) throw problem('campus_ranking_route_required', 409);
        const { rows } = await db.pool.query(
          'SELECT user_id,score,version FROM hd_scores WHERE school_id=$1 AND period=$2 ORDER BY score DESC,user_id',
          [s.schoolId, 'm0-trial'],
        );
        json(res, 200, { period: 'm0-trial', rows });
        return true;
      }
      if (action === 'contributions' && req.method === 'GET') {
        const { rows } = await db.pool.query(
          'SELECT * FROM hd_contributions WHERE school_id=$1 AND user_id=$2 ORDER BY id',
          [s.schoolId, u.user_id],
        );
        json(res, 200, { entries: rows });
        return true;
      }
      throw problem('route_missing', 404);
    },
    async close() {
      chat?.close();
      await jobs?.close();
      clearInterval(timer);
      while (syncing) await new Promise((r) => setTimeout(r, 20));
      await db.close();
    },
  };
}
