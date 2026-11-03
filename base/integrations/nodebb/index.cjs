'use strict';
// Separate GPL NodeBB service plugin. Does not link forum code into the MIT Base.
const crypto = require('node:crypto');
const bridgeRequest = require('./loopback-http.cjs');
const { AsyncLocalStorage } = require('node:async_hooks');
const editAuthority = new AsyncLocalStorage();
const nativeHash = (title, content) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([title, content]))
    .digest('hex');
const nconf = require.main.require('nconf'),
  db = require.main.require('./src/database'),
  user = require.main.require('./src/user'),
  posts = require.main.require('./src/posts'),
  topics = require.main.require('./src/topics'),
  meta = require.main.require('./src/meta');
const fail = (code, status = 403) => Object.assign(new Error(code), { status });
const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
let serial = Promise.resolve();
const exclusive = (fn) => {
  const p = serial.then(fn, fn);
  serial = p.catch(() => {});
  return p;
};
const config = () => nconf.get('hd');
async function base(path, data) {
  const c = config(),
    r = await bridgeRequest(c.baseUrl + '/m0/internal/forum/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HD-Service-Key': c.key },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
  if (!r.ok) throw fail('school_membership_denied');
  return r.json();
}
async function bind(identity) {
  const key = 'hd:identity:' + identity.userId;
  let uid = Number(await db.getObjectField(key, 'uid'));
  if (!uid) {
    uid = await user.create({ username: 'hd-' + identity.userId.replace(/-/g, '').slice(0, 25) });
    await db.setObject(key, { uid });
    await db.setObjectField('user:' + uid, 'hdUserId', identity.userId);
  }
  return uid;
}
async function item(id) {
  const r = await db.getObject('hd:item:' + id);
  if (!r) throw fail('source_missing', 404);
  return JSON.parse(r.json);
}
const save = (i) => db.setObject('hd:item:' + i.id, { json: JSON.stringify(i) });
async function parentAvailable(i) {
  if (i.parentId && (await item(i.parentId)).status !== 'published')
    throw fail('parent_unavailable', 404);
}
async function event(i, status, actor) {
  let reviewed;
  if (config().m1 && status === 'published') {
    const p = await posts.getPostFields(i.pid, ['content']),
      t = await topics.getTopicFields(i.tid, ['title']);
    i.nativeContentHash = nativeHash(i.parentId ? '' : t.title, p.content);
    reviewed={title:i.title,content:p.content};
  }
  const revision = (i.revision || 0) + 1;
  const e = {
    schema: 'hyper-dimension.event/v1',
    eventId: `${config().school}:nodebb:${i.id}:${revision}`,
    schoolId: config().school,
    source: { system: 'nodebb', id: i.id, revision, pid: i.pid, tid: i.tid },
    actor: { kind: 'human', userId: actor },
    subject: { userId: i.userId },
    status,
    visibility: 'school',
    period: 'm0-trial',
    occurredAt: new Date().toISOString(),
    ...(config().m1
      ? { organizationId: i.orgId || null, onBehalfOf: null, contentVersion: revision }
      : {}),
  };
  i.revision = revision;
  i.status = status;
  if (i.communityState) i.communityState = status;
  i.events.push(e);
  if(reviewed) {
    await db.setObject('hd:index-revision:'+i.id+':'+revision,{json:JSON.stringify({revision,...reviewed,recordedAt:e.occurredAt,baseline:false})});
    await db.sortedSetAdd('hd:index-revisions:'+i.id,revision,String(revision));
  }
  await save(i);
  return e;
}
module.exports = {
  async allowReviewedEdit(data) {
    const grant = editAuthority.getStore();
    if (grant && String(data.pid) === String(grant.pid) && String(data.uid) === String(grant.uid))
      return { ...data, edit: true, isEditor: true, isMod: true };
    return data;
  },
  async markQueue(payload) {
    if (config().m1 && payload.data.hdSourceId) {
      const i = await item(payload.data.hdSourceId);
      i.queueId = payload.id;
      await save(i);
    }
    return payload;
  },
  async markPost(payload) {
    if (config().m1 && payload.data.hdSourceId) {
      const i = await item(payload.data.hdSourceId);
      // Store native IDs before the post commit so recovery can inspect its outcome.
      i.pid = payload.post.pid;
      i.tid = payload.post.tid;
      payload.post.hdSourceId = i.id;
      await save(i);
    }
    return payload;
  },
  denySocket: async () => {
    throw fail('M0 realtime forum transport disabled; chat ACL is a later stage');
  },
  async preload({ app }) {
    const c = config();
    if (!c?.school || !c.key) throw Error('Missing private HD NodeBB config');
    await meta.configs.set('postQueue', 1);
    await meta.configs.set('enablePostHistory', 1);
    meta.config.enablePostHistory = 1;
    meta.config.postQueue = 1;
    await meta.configs.set('postQueueReputationThreshold', 1000000);
    meta.config.postQueueReputationThreshold = 1000000;
    await meta.configs.set('allowLocalLogin', 0);
    await meta.configs.set('registrationType', 'disabled');
    // Runs before native HTTP routes. Even existing forum sessions re-check Base membership.
    app.use(async (req, res, next) => {
      try {
        if (req.path.startsWith('/api/hd/') && same(req.headers['x-hd-service-key'], c.key))
          return next();
        if (req.path === '/api/hd/login') return next();
        if (
          req.method === 'GET' &&
          /^\/(assets|plugins|vendor|sounds|favicon\.ico)(\/|$)/.test(req.path)
        )
          return next();
        const uid = req.session?.hd?.userId;
        if (!uid) throw fail('school_login_required', 401);
        await base('member', { userId: uid });
        if (c.m1) throw fail('M1_use_scoped_bridge_routes', 403);
        // M0 exposes the reviewed workflow through HD's bridge only; do not allow a
        // second native write path that could bypass moderation events and the ledger.
        if (!['GET', 'HEAD'].includes(req.method)) throw fail('M0_native_write_disabled');
        next();
      } catch (e) {
        if (!e.status && /^\[\[error:(too-many-posts|user-too-new)/.test(e.message)) {
          e.status = 429;
          e.message = 'post_rate_limited';
        } else if (
          !e.status &&
          /^\[\[error:(content-too|title-too|no-privileges)/.test(e.message)
        ) {
          e.status = 400;
          e.message = 'forum_content_rejected';
        }
        res.status(e.status || 503).json({ error: e.message });
      }
    });
    const handlers = {};
    let community;
    function route(name, handler, method = 'post') {
      handlers[name] = handler;
      app[method]('/api/hd/' + name, async (req, res) => {
        try {
          if (name !== 'login' && !same(req.headers['x-hd-service-key'], c.key))
            throw fail('service_denied');
          const result = await exclusive(() => handler(req, res));
          if (!res.headersSent) res.json(result);
        } catch (e) {
          if (!e.status && /^\[\[error:(too-many-posts|user-too-new)/.test(e.message)) {
            e.status = 429;
            e.message = 'post_rate_limited';
          }
          require.main.require('winston').error('[hd/' + name + '] ' + e.stack);
          if (!res.headersSent)
            res
              .status(e.status || 500)
              .json({ error: e.status ? e.message : 'forum_operation_failed' });
        }
      });
    }
    route('health', async () => ({ gate: 'active', schoolId: c.school, version: '0.0.1' }));
    // Service-key-only source export; no user-supplied actor or private draft is accepted.
    const indexHead=async i=>{
      const parent=i.parentId?await item(i.parentId):null;
      let published=i.status==='published'&&(!parent||parent.status==='published'),unavailable=null;
      if(published&&i.nativeContentHash){
        const p=await posts.getPostFields(i.pid,['content']),t=await topics.getTopicFields(i.tid,['title']);
        if(nativeHash(i.parentId?'':t.title,p.content)!==i.nativeContentHash){published=false;unavailable='native_content_drift';}
      }
      return {id:i.id,revision:i.revision||0,scopeId:i.orgId||'',parentId:i.parentId||null,published,contentHash:unavailable||i.nativeContentHash||null,unavailable};
    };
    route('index-inventory',async req=>{
      const {after='',limit=100}=req.body;
      if(typeof after!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>200)throw fail('index_page_invalid',400);
      const ids=(await db.getSortedSetRange('hd:items',0,-1)).sort().filter(id=>id>after);
      const heads=[];for(const id of ids.slice(0,limit))heads.push(await indexHead(await item(id)));
      return {items:heads,next:ids.length>limit?ids[limit-1]:null};
    });
    route('index-source',async req=>{
      const {id,afterRevision=0}=req.body;
      if(typeof id!=='string'||!/^[a-zA-Z0-9._:-]{1,128}$/.test(id)||!Number.isSafeInteger(afterRevision)||afterRevision<0)throw fail('index_source_invalid',400);
      const i=await item(id),head=await indexHead(i);
      if(req.body.headOnly===true)return {...head,versions:[],hasMore:false};
      if(!head.published)return {...head,versions:[],hasMore:false};
      const key='hd:index-revisions:'+i.id;
      if(!(await db.getSortedSetRange(key,0,0)).length) {
        // Legacy content can establish a truthful current baseline, not invented old revisions.
        const p=await posts.getPostFields(i.pid,['content']);
        await db.setObject('hd:index-revision:'+i.id+':'+i.revision,{json:JSON.stringify({revision:i.revision,title:i.title,content:p.content,baseline:true,recordedAt:new Date().toISOString()})});
        await db.sortedSetAdd(key,i.revision,String(i.revision));
      }
      const ids=(await db.getSortedSetRange(key,0,-1)).map(Number).filter(r=>r>afterRevision&&r<=head.revision).sort((a,b)=>a-b),versions=[];
      for(const r of ids.slice(0,20)){const v=await db.getObject('hd:index-revision:'+i.id+':'+r);if(!v)throw fail('index_history_missing',503);versions.push(JSON.parse(v.json));}
      return {...head,versions,hasMore:ids.length>20};
    });
    route('posting-state', async (req) => {
      const who = await base('member', { userId: req.body.userId }),
        uid = await bind(who);
      const u = await user.getUserFields(uid, [
        'lastqueuetime',
        'lastposttime',
        'reputation',
        'joindate',
      ]);
      const delay =
        meta.config.newbieReputationThreshold > u.reputation
          ? Math.max(meta.config.newbiePostDelay, meta.config.postDelay)
          : meta.config.postDelay;
      return {
        retryAfterMs: Math.max(
          0,
          Number(meta.config.initialPostDelay || 0) * 1000 - (Date.now() - Number(u.joindate || 0)),
          Number(delay) * 1000 - (Date.now() - Math.max(u.lastqueuetime || 0, u.lastposttime || 0)),
        ),
      };
    });
    route('bind', async (req) => {
      const who = await base('ticket', { ticket: req.body.ticket });
      return { uid: await bind(who), userId: who.userId };
    });
    route(
      'login',
      async (req, res) => {
        const who = await base('ticket', { ticket: req.query.ticket }),
          uid = await bind(who);
        req.session.hd = { userId: who.userId };
        req.session.passport = { user: uid };
        await new Promise((resolve, reject) =>
          req.session.save((e) => (e ? reject(e) : resolve())),
        );
        res.redirect('/');
      },
      'get',
    );
    route('list', async (req) => {
      const who = await base('member', {
          userId: req.body.userId,
          orgId: req.body.orgId || null,
          action: 'read',
        }),
        ids = await db.getSortedSetRange('hd:items', 0, -1),
        items = await Promise.all(ids.map(item));
      return {
        items: items
          .filter((i) => !c.m1 || (i.orgId || null) === (req.body.orgId || null))
          .filter(
            (i) =>
              !i.parentId ||
              items.find((parent) => parent.id === i.parentId)?.status === 'published' ||
              i.userId === who.userId ||
              ['moderator', 'owner'].includes(who.role),
          )
          .filter(
            (i) =>
              i.status === 'published' ||
              i.userId === who.userId ||
              ['moderator', 'owner'].includes(who.role),
          )
          .map((i) => ({
            id: i.id,
            title: i.title,
            status: i.status,
            pid: i.pid,
            tid: i.tid,
            revision: i.revision,
            userId: i.userId,
            parentId: i.parentId || null,
            hasDraft: Boolean(i.draft),
          })),
        schoolId: c.school,
      };
    });
    route('events', async () => {
      const ids = await db.getSortedSetRange('hd:items', 0, -1);
      return { events: (await Promise.all(ids.map(item))).flatMap((i) => i.events) };
    });
    async function fault(point) {
      if (!c.allowFaults) return;
      if ((await db.getObjectField('hd:fault', 'point')) === point) {
        await db.setObject('hd:fault', { point: 'none' });
        throw fail('injected_' + point, 503);
      }
    }
    route('fault', async (req) => {
      if (!c.m1 || !c.allowFaults) throw fail('fault_injection_disabled');
      if (
        !['after-queue', 'after-publish', 'after-withdraw', 'after-edit', 'none'].includes(
          req.body.point,
        )
      )
        throw fail('invalid_fault', 400);
      await db.setObject('hd:fault', { point: req.body.point });
      return { armed: true };
    });
    route('reconcile', async () => {
      if (!c.m1) return { recovered: [], blocked: [] };
      const recovered = [],
        blocked = [];
      for (const id of await db.getSortedSetRange('hd:items', 0, -1)) {
        const i = await item(id);
        if (!i.intent) {
          if (i.status === 'published') {
            const p = await posts.getPostFields(i.pid, ['content', 'deleted']),
              t = await topics.getTopicFields(i.tid, ['title', 'mainPid', 'deleted']);
            if (i.parentId && (await item(i.parentId)).status === 'withdrawn') {
              const parent = await item(i.parentId),
                actor = parent.events[parent.events.length - 1].actor.userId;
              i.intent = { action: 'withdraw', actor };
              await save(i);
              if (!Number(p.deleted)) await posts.delete(i.pid, await bind({ userId: actor }));
              delete i.intent;
              await event(i, 'withdrawn', actor);
              recovered.push({ id, action: 'parent-withdraw' });
              continue;
            }
            if (
              !p?.content ||
              Number(p.deleted) ||
              Number(t?.deleted) ||
              (!i.parentId && String(t?.mainPid) !== String(i.pid))
            )
              blocked.push({ id, reason: 'native_state_drift' });
            else if (
              i.nativeContentHash &&
              nativeHash(i.parentId ? '' : t.title, p.content) !== i.nativeContentHash
            )
              blocked.push({ id, reason: 'native_content_drift' });
          }
          continue;
        }
        if (i.intent.action === 'submit') {
          if (i.queueId && (await posts.getFromQueue(i.queueId))) {
            i.status = 'pending';
            delete i.intent;
            await save(i);
            recovered.push({ id, action: 'submit' });
          } else if (!i.queueId) {
            // The durable queue hook runs before any native queue write. Without an assigned
            // ID no post commit was attempted. Keep a rejected receipt; never auto-resubmit.
            i.status = 'rejected';
            i.rejection = { code: 'submission_not_committed_retry_new_request', status: 409 };
            delete i.intent;
            await save(i);
            recovered.push({ id, action: 'submit-not-committed' });
          } else blocked.push({ id, reason: 'queue_outcome_ambiguous' });
        } else if (i.intent.action === 'approve') {
          const post = i.pid
            ? await posts.getPostFields(i.pid, ['hdSourceId', 'tid', 'deleted'])
            : null;
          const topic = i.tid ? await topics.getTopicFields(i.tid, ['mainPid', 'deleted']) : null;
          if (
            post &&
            post.hdSourceId === i.id &&
            String(post.tid) === String(i.tid) &&
            (i.parentId || String(topic?.mainPid) === String(i.pid)) &&
            !Number(post.deleted) &&
            !Number(topic.deleted)
          ) {
            if (i.queueId && (await posts.getFromQueue(i.queueId)))
              await posts.removeFromQueue(i.queueId);
            const actor = i.intent.actor;
            delete i.intent;
            await event(i, 'published', actor);
            recovered.push({ id, action: 'approve' });
          } else blocked.push({ id, reason: 'native_publish_outcome_ambiguous' });
        } else if (i.intent.action === 'edit') {
          const p = await posts.getPostFields(i.pid, ['content', 'deleted']),
            t = await topics.getTopicFields(i.tid, ['title', 'deleted']);
          const h = nativeHash(i.parentId ? '' : t.title, p.content);
          if (!Number(p.deleted) && !Number(t.deleted) && h === i.intent.targetHash) {
            const actor = i.intent.actor;
            i.title = i.parentId ? i.title : i.draft.title;
            i.editRequests = i.editRequests || {};
            i.editRequests[i.intent.requestId] = {
              hash: i.intent.inputHash,
              revision: i.revision + 1,
            };
            delete i.intent;
            delete i.draft;
            await event(i, 'published', actor);
            recovered.push({ id, action: 'edit' });
          } else
            blocked.push({
              id,
              reason:
                h === i.intent.beforeHash
                  ? 'native_edit_not_committed'
                  : 'native_edit_outcome_ambiguous',
            });
        } else if (i.intent.action === 'withdraw') {
          const post = await posts.getPostFields(i.pid, ['deleted']);
          if (Number(post?.deleted) === 1) {
            if (!i.parentId) await topics.setTopicField(i.tid, 'deleted', 1);
            const actor = i.intent.actor;
            delete i.intent;
            await event(i, 'withdrawn', actor);
            recovered.push({ id, action: 'withdraw' });
          } else blocked.push({ id, reason: 'native_withdraw_not_committed' });
        } else if (i.intent.action === 'community-restore') {
          const post = await posts.getPostFields(i.pid, ['deleted']);
          if (post && Number(post.deleted) === 0) {
            if (!i.parentId) await topics.setTopicField(i.tid, 'deleted', 0);
            const actor = i.intent.actor;
            delete i.intent;
            await event(i, 'published', actor);
            recovered.push({ id, action: 'community-restore' });
          } else blocked.push({ id, reason: 'native_restore_not_committed' });
        }
      }
      if (community) await community.recover();
      return { recovered, blocked };
    });
    route('submit', async (req) => {
      const who = await base('member', {
          userId: req.body.userId,
          orgId: req.body.orgId || null,
          action: 'read',
        }),
        b = req.body;
      if (
        typeof b.title !== 'string' ||
        b.title.length < 3 ||
        b.title.length > 80 ||
        typeof b.content !== 'string' ||
        b.content.length < 8 ||
        b.content.length > 3000 ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(b.requestId || '')
      )
        throw fail('invalid_content', 400);
      const id = crypto
          .createHash('sha256')
          .update(who.userId + ':' + b.requestId)
          .digest('hex')
          .slice(0, 32),
        fingerprint = crypto
          .createHash('sha256')
          .update(
            JSON.stringify([
              b.title,
              b.content,
              ...(c.m1 ? [b.orgId || null, b.parentId || null] : []),
              ...(b.community ? [b.community] : []),
            ]),
          )
          .digest('hex');
      const existing = await db.getObject('hd:item:' + id);
      if (existing) {
        const i = JSON.parse(existing.json);
        if (i.fingerprint !== fingerprint) throw fail('request_conflict', 409);
        if (i.intent) throw fail('source_needs_reconciliation', 409);
        if (i.status === 'rejected')
          throw fail(i.rejection?.code || 'submission_rejected', i.rejection?.status || 409);
        return i;
      }
      const uid = await bind(who),
        cids = await db.getSortedSetRange('categories:cid', 0, -1),
        cid = Number(b.community?.categoryId || cids[0]);
      const parent = b.parentId ? await item(b.parentId) : null;
      if (
        parent &&
        (parent.parentId ||
          parent.status !== 'published' ||
          (parent.orgId || null) !== (b.orgId || null))
      )
        throw fail('reply_scope_denied');
      let prepared;
      if (c.m1) {
        prepared = {
          id,
          userId: who.userId,
          forumUid: uid,
          title: b.title,
          fingerprint,
          orgId: b.orgId || null,
          status: 'preparing',
          revision: 0,
          events: [],
          intent: { action: 'submit', actor: who.userId },
          ...(b.community ? { community: b.community } : {}),
          ...(parent ? { parentId: parent.id } : {}),
        };
        await save(prepared);
        await db.sortedSetAdd('hd:items', Date.now(), id);
      }
      let queued;
      try {
        queued = await posts.addToQueue({
          uid,
          ...(parent ? { tid: parent.tid } : { cid }),
          title: b.title,
          content: b.content,
          timestamp: Date.now(),
          ...(c.m1 ? { hdSourceId: id } : {}),
        });
      } catch (e) {
        if (c.m1) {
          const current = await item(id);
          if (!current.queueId) {
            current.status = 'rejected';
            current.rejection = {
              code: /^\[\[error:(too-many-posts|user-too-new)/.test(e.message)
                ? 'post_rate_limited'
                : 'forum_content_rejected',
              status: /^\[\[error:(too-many-posts|user-too-new)/.test(e.message) ? 429 : 400,
            };
            delete current.intent;
            await save(current);
          }
        }
        throw e;
      }
      const i = {
        id,
        userId: who.userId,
        forumUid: uid,
        title: b.title,
        fingerprint,
        queueId: queued.id,
        status: 'pending',
        revision: 0,
        events: [],
        ...(c.m1 ? { orgId: b.orgId || null } : {}),
        ...(b.community ? { community: b.community } : {}),
        ...(parent ? { parentId: parent.id } : {}),
      };
      await fault('after-queue');
      await save(i);
      await db.sortedSetAdd('hd:items', Date.now(), id);
      return i;
    });
    route('detail', async (req) => {
      const who = await base('member', {
          userId: req.body.userId,
          orgId: req.body.orgId || null,
          action: 'read',
        }),
        i = await item(req.body.id);
      if ((i.orgId || null) !== (req.body.orgId || null)) throw fail('source_scope_denied');
      await parentAvailable(i);
      const privileged = ['owner', 'moderator'].includes(who.role),
        own = i.userId === who.userId;
      if (i.status !== 'published' && !own && !privileged) throw fail('source_not_published');
      let content = null;
      if (i.status === 'published')
        content = (await posts.getPostFields(i.pid, ['content'])).content;
      else if (i.status === 'pending') {
        const q = await posts.getFromQueue(i.queueId);
        content = q?.data?.content || q?.content || null;
      }
      return {
        id: i.id,
        title: i.title,
        content,
        status: i.status,
        revision: i.revision,
        parentId: i.parentId || null,
        pid: i.pid,
        tid: i.tid,
        userId: i.userId,
        draft: own || privileged ? i.draft || null : null,
        canEdit: i.status === 'published' && (own || privileged),
        canModerate: privileged,
      };
    });
    route('edit', async (req) => {
      const b = req.body,
        who = await base('member', { userId: b.userId, orgId: b.orgId || null, action: 'read' }),
        i = await item(b.id);
      await parentAvailable(i);
      if (
        (i.orgId || null) !== (b.orgId || null) ||
        (i.userId !== who.userId && !['owner', 'moderator'].includes(who.role))
      )
        throw fail('edit_denied');
      if (
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(b.requestId || '') ||
        typeof b.title !== 'string' ||
        b.title.length < 3 ||
        b.title.length > 80 ||
        typeof b.content !== 'string' ||
        b.content.length < 8 ||
        b.content.length > 3000
      )
        throw fail('invalid_content', 400);
      const fingerprint = nativeHash(b.title, b.content),
        old = i.draftRequests?.[b.requestId];
      if (old) {
        if (old.hash !== fingerprint || old.expectedRevision !== b.expectedRevision)
          throw fail('request_conflict', 409);
        return { id: i.id, draftId: old.draftId, revision: i.revision };
      }
      if (i.intent || i.status !== 'published' || i.revision !== b.expectedRevision)
        throw fail('source_write_conflict', 409);
      if (i.draft) throw fail('pending_draft_exists', 409);
      const draftId = crypto.randomUUID();
      i.draft = {
        id: draftId,
        title: i.parentId ? i.title : b.title,
        content: b.content,
        by: who.userId,
        expectedRevision: b.expectedRevision,
      };
      i.draftRequests = i.draftRequests || {};
      i.draftRequests[b.requestId] = {
        hash: fingerprint,
        draftId,
        expectedRevision: b.expectedRevision,
      };
      await save(i);
      return { id: i.id, draftId, revision: i.revision };
    });
    route('reject-edit', async (req) => {
      const b = req.body,
        who = await base('member', {
          userId: b.userId,
          orgId: b.orgId || null,
          action: 'moderate',
        }),
        i = await item(b.id);
      if ((i.orgId || null) !== (b.orgId || null)) throw fail('source_scope_denied');
      if (i.intent || i.revision !== b.expectedRevision || i.draft?.id !== b.draftId)
        throw fail('source_write_conflict', 409);
      i.rejectedDrafts = i.rejectedDrafts || [];
      i.rejectedDrafts.push({ id: i.draft.id, by: who.userId, at: new Date().toISOString() });
      delete i.draft;
      await save(i);
      return { id: i.id, rejected: true, revision: i.revision };
    });
    route('approve-edit', async (req) => {
      const b = req.body,
        who = await base('member', {
          userId: b.userId,
          orgId: b.orgId || null,
          action: 'moderate',
        }),
        i = await item(b.id);
      if ((i.orgId || null) !== (b.orgId || null)) throw fail('source_scope_denied');
      await parentAvailable(i);
      const fingerprint = nativeHash(b.draftId, b.expectedRevision),
        old = i.editRequests?.[b.requestId];
      if (old) {
        if (old.hash !== fingerprint) throw fail('request_conflict', 409);
        return { id: i.id, revision: old.revision };
      }
      if (
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(b.requestId || '') ||
        i.intent ||
        i.status !== 'published' ||
        i.revision !== b.expectedRevision ||
        i.draft?.id !== b.draftId
      )
        throw fail('source_write_conflict', 409);
      const p = await posts.getPostFields(i.pid, ['content']),
        t = await topics.getTopicFields(i.tid, ['title']);
      const beforeHash = nativeHash(i.parentId ? '' : t.title, p.content),
        title = i.parentId ? t.title : i.draft.title;
      if (i.nativeContentHash && i.nativeContentHash !== beforeHash)
        throw fail('native_content_drift', 409);
      const uid = await bind(who);
      i.intent = {
        action: 'edit',
        actor: who.userId,
        requestId: b.requestId,
        inputHash: fingerprint,
        beforeHash,
        targetHash: nativeHash(i.parentId ? '' : title, i.draft.content),
      };
      await save(i);
      await editAuthority.run({ pid: i.pid, uid }, () =>
        posts.edit({ uid, pid: i.pid, title, content: i.draft.content }),
      );
      await fault('after-edit');
      i.title = i.parentId ? i.title : i.draft.title;
      i.editRequests = i.editRequests || {};
      i.editRequests[b.requestId] = { hash: fingerprint, revision: i.revision + 1 };
      delete i.intent;
      delete i.draft;
      await event(i, 'published', who.userId);
      return { id: i.id, revision: i.revision };
    });
    route('approve', async (req) => {
      const who = await base('member', {
        userId: req.body.userId,
        orgId: req.body.orgId || null,
        action: 'moderate',
      });
      if (!['moderator', 'owner'].includes(who.role)) throw fail('moderation_denied');
      const i = await item(req.body.id);
      if (c.m1 && (i.orgId || null) !== (req.body.orgId || null)) throw fail('source_scope_denied');
      if (i.intent) throw fail('source_needs_reconciliation', 409);
      if (i.status === 'published') return i;
      if (i.status !== 'pending') throw fail('source_state_conflict', 409);
      if (c.m1) {
        i.intent = { action: 'approve', actor: who.userId };
        await save(i);
      }
      const submitted = await posts.submitFromQueue(i.queueId);
      if (!submitted) throw fail('approval_needs_reconciliation', 409);
      i.pid = submitted.pid;
      i.tid = submitted.tid;
      await fault('after-publish');
      delete i.intent;
      await event(i, 'published', who.userId);
      return i;
    });
    route('withdraw', async (req) => {
      const who = await base('member', {
        userId: req.body.userId,
        orgId: req.body.orgId || null,
        action: 'moderate',
      });
      if (!['moderator', 'owner'].includes(who.role)) throw fail('moderation_denied');
      const i = await item(req.body.id);
      if (c.m1 && (i.orgId || null) !== (req.body.orgId || null)) throw fail('source_scope_denied');
      if (i.intent) throw fail('source_needs_reconciliation', 409);
      if (i.status === 'withdrawn') return i;
      if (i.status !== 'published') throw fail('source_state_conflict', 409);
      const uid = await bind(who);
      if (c.m1) {
        i.intent = { action: 'withdraw', actor: who.userId };
        await save(i);
      }
      await posts.delete(i.pid, uid);
      if (!i.parentId) await topics.setTopicField(i.tid, 'deleted', 1);
      await fault('after-withdraw');
      delete i.intent;
      await event(i, 'withdrawn', who.userId);
      return i;
    });
    if (c.m1)
      community = require('./community.cjs')({
        route,
        handlers,
        db,
        posts,
        topics,
        base,
        bind,
        item,
        save,
        event,
        config,
        fail,
      });
  },
};
