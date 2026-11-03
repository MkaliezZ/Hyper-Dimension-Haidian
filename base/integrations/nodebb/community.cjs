'use strict';
// GPL-3.0 NodeBB adapter. Native queue/posts remain the only content authority.
const crypto = require('node:crypto');
module.exports = function install({
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
}) {
  const categories = require.main.require('./src/categories');
  const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const text = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
  const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(v);
  const mod = (who) => ['owner', 'moderator'].includes(who.role);
  const scope = (b, action = 'read') =>
    base('member', { userId: b.userId, orgId: b.orgId || null, action });
  const scoped = (i, b) => {
    if ((i.orgId || null) !== (b.orgId || null)) throw fail('source_scope_denied');
  };
  const read = async (key) => {
    const x = await db.getObject(key);
    return x ? JSON.parse(x.json) : null;
  };
  const write = (key, x) => db.setObject(key, { json: JSON.stringify(x) });
  async function receipt(b, action, fn) {
    if (!id(b.requestId)) throw fail('request_id_required', 400);
    const key = 'hd:community:receipt:' + hash([b.userId, b.requestId]),
      fingerprint = hash([action, b]);
    const old = await read(key);
    if (old) {
      if (old.hash !== fingerprint) throw fail('request_conflict', 409);
      return old.result;
    }
    const result = await fn();
    await write(key, { hash: fingerprint, result });
    return result;
  }
  async function category(b, cid) {
    if (cid === null || cid === undefined || cid === '') return null;
    const cat = await read('hd:community:category:' + String(cid));
    if (!cat || (cat.orgId || null) !== (b.orgId || null)) throw fail('category_scope_denied');
    return cat;
  }
  async function available(i, who) {
    if (i.parentId && (await item(i.parentId)).status !== 'published') return false;
    return i.status === 'published' || i.userId === who.userId || mod(who);
  }
  async function content(i) {
    if (i.pid) return (await posts.getPostFields(i.pid, ['content'])).content || '';
    if (i.queueId) {
      const q = await posts.getFromQueue(i.queueId);
      return q?.data?.content || q?.content || '';
    }
    return '';
  }
  function summary(i) {
    return {
      id: i.id,
      userId: i.userId,
      title: i.title,
      status: i.communityState || i.status,
      sourceStatus: i.status,
      revision: i.revision,
      workflowVersion: i.workflowVersion || 0,
      parentId: i.parentId || null,
      pid: i.pid || null,
      tid: i.tid || null,
      categoryId: i.community?.categoryId || null,
      anchor: i.community?.anchor || null,
      hasDraft: Boolean(i.draft),
      source: 'nodebb',
      attachmentIds: i.community?.attachmentIds || [],
    };
  }
  function trail(i, b, action) {
    i.workflowVersion = (i.workflowVersion || 0) + 1;
    i.communityTrail ||= [];
    i.communityTrail.push({
      action,
      userId: b.userId,
      reason: b.reason,
      requestId: b.requestId,
      at: new Date().toISOString(),
      revision: i.revision,
      workflowVersion: i.workflowVersion,
    });
  }
  async function finish(i) {
    const p = i.communityPending;
    if (!p || i.intent || (p.requiresDraftRemoved && i.draft)) return false;
    if (i.revision !== p.targetRevision || i.status !== p.targetStatus) return false;
    i.communityState = p.displayStatus;
    if (p.action === 'review-appeal')
      i.appeal = { ...i.appeal, resolved: true, decision: p.decision, resolution: p.reason };
    if (p.reportId) {
      const r = i.reports?.find((x) => x.id === p.reportId);
      if (r) Object.assign(r, { resolved: true, decision: p.decision, resolution: p.reason });
    }
    trail(i, p, p.action);
    i.communityRequests ||= {};
    i.communityRequests[p.requestId] = { hash: p.hash, result: summary(i) };
    delete i.communityPending;
    await save(i);
    return true;
  }
  route('community-categories', async (req) => {
    const b = req.body;
    await scope(b);
    const cats = await Promise.all(
      (await db.getSortedSetRange('hd:community:categories', 0, -1)).map((cid) =>
        read('hd:community:category:' + cid),
      ),
    );
    return { items: cats.filter((c) => c && (c.orgId || null) === (b.orgId || null)) };
  });
  route('community-category-create', async (req) => {
    const b = req.body;
    await scope(b, 'moderate');
    if (!text(b.name, 2, 80) || !text(b.description, 0, 500)) throw fail('category_invalid', 400);
    return receipt(b, 'category-create', async () => {
      const result = await categories.create({ name: b.name, description: b.description });
      const cat = {
        categoryId: String(result.cid),
        name: b.name,
        description: b.description,
        orgId: b.orgId || null,
      };
      await write('hd:community:category:' + cat.categoryId, cat);
      await db.sortedSetAdd('hd:community:categories', Date.now(), cat.categoryId);
      return cat;
    });
  });
  route('community-list', async (req) => {
    const b = req.body,
      who = await scope(b),
      page = b.page ?? 0,
      limit = b.limit ?? 20,
      q = b.query || '';
    if (
      !Number.isSafeInteger(page) ||
      page < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !text(q, 0, 80)
    )
      throw fail('page_invalid', 400);
    if (b.categoryId) await category(b, b.categoryId);
    const result = [];
    for (const id of await db.getSortedSetRevRange('hd:items', 0, -1)) {
      const i = await item(id);
      if ((i.orgId || null) !== (b.orgId || null) || !(await available(i, who))) continue;
      if (b.publishedOnly && i.status !== 'published') continue;
      if (b.categoryId && i.community?.categoryId !== String(b.categoryId)) continue;
      if (b.parentId ? i.parentId !== b.parentId : Boolean(i.parentId)) continue;
      if (
        b.anchor &&
        (i.community?.anchor?.entityId !== b.anchor.entityId ||
          i.community?.anchor?.sceneId !== b.anchor.sceneId)
      )
        continue;
      if (
        q &&
        !(i.title + '\n' + (await content(i))).toLocaleLowerCase().includes(q.toLocaleLowerCase())
      )
        continue;
      result.push(summary(i));
    }
    return {
      items: result.slice(page * limit, (page + 1) * limit),
      page,
      limit,
      total: result.length,
      hasMore: (page + 1) * limit < result.length,
    };
  });
  route('community-detail', async (req) => {
    const b = req.body,
      who = await scope(b),
      i = await item(b.id);
    scoped(i, b);
    if (!(await available(i, who))) throw fail('source_not_published');
    const own = i.userId === who.userId,
      privileged = mod(who);
    return {
      ...summary(i),
      content: await content(i),
      own,
      canModerate: privileged,
      draft: own || privileged ? i.draft || null : null,
      trail: own || privileged ? i.communityTrail || [] : [],
      reports: privileged
        ? i.reports || []
        : (i.reports || []).filter((r) => r.userId === who.userId),
      appeal: own || privileged ? i.appeal || null : null,
    };
  });
  route('community-drafts', async (req) => {
    const b = req.body;
    await scope(b);
    const drafts = await Promise.all(
      (await db.getSortedSetRevRange('hd:community:drafts:' + b.userId, 0, -1)).map((id) =>
        read('hd:community:draft:' + id),
      ),
    );
    return { items: drafts.filter((d) => d && (d.orgId || null) === (b.orgId || null)) };
  });
  route('community-draft', async (req) => {
    const b = req.body,
      who = await scope(b);
    if (
      !text(b.title, 3, 80) ||
      !text(b.content, 8, 3000) ||
      !Number.isSafeInteger(b.expectedVersion) ||
      b.expectedVersion < 0
    )
      throw fail('draft_invalid', 400);
    await category(b, b.categoryId);
    if (b.parentId) {
      const parent = await item(b.parentId);
      scoped(parent, b);
      if (parent.parentId || parent.status !== 'published') throw fail('reply_scope_denied');
    }
    return receipt(b, 'draft', async () => {
      const draftId = b.draftId || hash([who.userId, b.requestId]).slice(0, 32),
        old = await read('hd:community:draft:' + draftId);
      if (old && old.userId !== who.userId) throw fail('draft_owner_required');
      if ((old?.orgId || null) !== (b.orgId || null) && old) throw fail('source_scope_denied');
      if ((old?.version || 0) !== b.expectedVersion || old?.status === 'submitted')
        throw fail('draft_write_conflict', 409);
      if (old?.sourceId && (await read('hd:item:' + old.sourceId)))
        throw fail('source_submission_requires_recovery', 409);
      const sourceId = crypto
        .createHash('sha256')
        .update(who.userId + ':community:' + draftId)
        .digest('hex')
        .slice(0, 32);
      const d = {
        draftId,
        sourceId,
        userId: who.userId,
        orgId: b.orgId || null,
        title: b.title,
        content: b.content,
        categoryId: b.categoryId || null,
        anchor: b.anchor || null,
        parentId: b.parentId || null,
        attachmentIds: old?.attachmentIds || [],
        version: b.expectedVersion + 1,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      };
      if (b.parentId) {
        const parent = await item(b.parentId);
        d.categoryId = parent.community?.categoryId || null;
        d.anchor = parent.community?.anchor || null;
      }
      await write('hd:community:draft:' + draftId, d);
      await write('hd:community:source-draft:' + sourceId, { draftId });
      await db.sortedSetAdd('hd:community:drafts:' + who.userId, Date.now(), draftId);
      return d;
    });
  });
  route('community-submit', async (req) => {
    const b = req.body,
      who = await scope(b),
      d = await read('hd:community:draft:' + b.draftId);
    if (!d || d.userId !== who.userId) throw fail('draft_owner_required');
    scoped(d, b);
    return receipt(b, 'submit', async () => {
      if (
        d.version !== b.expectedVersion ||
        (d.status === 'submitted' && d.submitRequest !== b.requestId)
      )
        throw fail('draft_write_conflict', 409);
      await category(b, d.categoryId);
      // Respect native posting cooldown before reserving the stable source ID.
      // A rejected rate-limited attempt must not leave an unretryable source receipt.
      if (
        !(await read('hd:item:' + d.sourceId)) &&
        (await handlers['posting-state']({ body: { userId: who.userId } })).retryAfterMs > 0
      )
        throw fail('post_rate_limited', 429);
      d.submitRequest = b.requestId;
      await write('hd:community:draft:' + d.draftId, d);
      const i = await handlers.submit({
        body: {
          userId: who.userId,
          orgId: b.orgId || null,
          requestId: 'community:' + d.draftId,
          title: d.title,
          content: d.content,
          parentId: d.parentId,
          community: {
            categoryId: d.categoryId,
            anchor: d.anchor,
            attachmentIds: d.attachmentIds || [],
          },
        },
      });
      d.status = 'submitted';
      d.sourceId = i.id;
      d.submitRequest = b.requestId;
      await write('hd:community:draft:' + d.draftId, d);
      return summary(i);
    });
  });
  route('community-attachment-add', async (req) => {
    const b = req.body,
      who = await scope(b),
      mapping = await read('hd:community:source-draft:' + b.id),
      d = mapping && (await read('hd:community:draft:' + mapping.draftId));
    if (!d || d.userId !== who.userId) throw fail('draft_owner_required');
    scoped(d, b);
    if (!id(b.attachmentId)) throw fail('attachment_invalid', 400);
    return receipt(b, 'attachment-add', async () => {
      if (d.status !== 'draft') throw fail('attachment_requires_draft', 409);
      if (await read('hd:item:' + d.sourceId))
        throw fail('source_submission_requires_recovery', 409);
      if ((d.attachmentIds || []).length >= 8) throw fail('attachment_limit', 409);
      d.attachmentIds = [...new Set([...(d.attachmentIds || []), b.attachmentId])];
      d.version++;
      await write('hd:community:draft:' + d.draftId, d);
      return d;
    });
  });
  route('community-attachment-read', async (req) => {
    const b = req.body,
      mapping = await read('hd:community:source-draft:' + b.sourceId),
      d = mapping && (await read('hd:community:draft:' + mapping.draftId));
    if (d && d.status === 'draft') {
      await scope({ ...b, orgId: d.orgId });
      return { allowed: d.userId === b.userId && d.attachmentIds?.includes(b.attachmentId) };
    }
    const i = await item(b.sourceId),
      who = await scope({ ...b, orgId: i.orgId });
    return {
      allowed: Boolean(
        i.community?.attachmentIds?.includes(b.attachmentId) && (await available(i, who)),
      ),
    };
  });
  route('community-action', async (req) => {
    const b = req.body,
      who = await scope(b),
      i = await item(b.id);
    scoped(i, b);
    if (!id(b.requestId) || !text(b.reason, 3, 500)) throw fail('reason_required', 400);
    const action = b.action,
      own = who.userId === i.userId,
      privileged = mod(who),
      fingerprint = hash(b);
    const old = i.communityRequests?.[b.requestId];
    if (old) {
      if (old.hash !== fingerprint) throw fail('request_conflict', 409);
      return old.result;
    }
    if (i.communityPending) {
      if (i.communityPending.requestId !== b.requestId || i.communityPending.hash !== fingerprint)
        throw fail('source_needs_reconciliation', 409);
      await handlers.reconcile({ body: {} });
      const recovered = await item(i.id);
      await finish(recovered);
      if (recovered.communityRequests?.[b.requestId])
        return recovered.communityRequests[b.requestId].result;
      if (
        !recovered.intent &&
        recovered.revision === b.expectedRevision &&
        (recovered.workflowVersion || 0) === b.expectedWorkflowVersion
      ) {
        delete recovered.communityPending;
        await save(recovered);
        return handlers['community-action'](req);
      }
      throw fail('source_needs_reconciliation', 409);
    }
    if (
      i.intent ||
      i.revision !== b.expectedRevision ||
      (i.workflowVersion || 0) !== b.expectedWorkflowVersion
    )
      throw fail('source_write_conflict', 409);
    if (
      [
        'approve',
        'reject',
        'hide',
        'review-report',
        'review-appeal',
        'approve-edit',
        'reject-edit',
      ].includes(action) &&
      !privileged
    )
      throw fail('moderation_denied');
    if (['withdraw', 'appeal'].includes(action) && !own) throw fail('source_owner_required');
    if (action === 'report') {
      if (i.status !== 'published' || !(await available(i, who)))
        throw fail('source_not_published');
      i.reports ||= [];
      i.reports.push({
        id: crypto.randomUUID(),
        userId: who.userId,
        reason: b.reason,
        revision: i.revision,
        resolved: false,
      });
    } else if (action === 'reject') {
      if (i.status !== 'pending' || i.communityState === 'rejected')
        throw fail('source_state_conflict', 409);
      // Keep the native queue and original body for an appeal; never award publication credit.
      i.communityState = 'rejected';
    } else if (action === 'appeal') {
      if (
        !['hidden', 'withdrawn', 'rejected'].includes(i.communityState || i.status) ||
        (i.appeal && !i.appeal.resolved)
      )
        throw fail('appeal_state_conflict', 409);
      i.appeal = { userId: who.userId, reason: b.reason, revision: i.revision, resolved: false };
      i.communityState = 'appealed';
    } else if (action === 'review-report' && b.decision === 'dismiss') {
      const r = i.reports?.find((r) => r.id === b.reportId);
      if (!r || r.resolved) throw fail('report_state_conflict', 409);
      Object.assign(r, { resolved: true, decision: 'dismiss', resolution: b.reason });
    } else if (action === 'review-appeal' && b.decision === 'reject') {
      if (!i.appeal || i.appeal.resolved) throw fail('appeal_state_conflict', 409);
      Object.assign(i.appeal, { resolved: true, decision: 'reject', resolution: b.reason });
      i.communityState = 'hidden';
    } else if (['approve-edit', 'reject-edit'].includes(action)) {
      i.communityPending = {
        ...b,
        hash: fingerprint,
        targetStatus: 'published',
        displayStatus: 'published',
        targetRevision: i.revision + (action === 'approve-edit' ? 1 : 0),
        requiresDraftRemoved: true,
      };
      await save(i);
      await handlers[action]({ body: b });
      const changed = await item(i.id);
      if (!(await finish(changed))) throw fail('source_needs_reconciliation', 409);
      return changed.communityRequests[b.requestId].result;
    } else {
      const restore = action === 'review-appeal' && b.decision === 'restore';
      const hide = action === 'hide' || (action === 'review-report' && b.decision === 'hide');
      if (!restore && !hide && !['approve', 'withdraw'].includes(action))
        throw fail('community_action_invalid', 400);
      if (
        restore &&
        (!i.appeal ||
          i.appeal.resolved ||
          !((i.status === 'withdrawn' && i.pid) || (i.status === 'pending' && i.queueId)))
      )
        throw fail('appeal_state_conflict', 409);
      if (action === 'review-report' && !i.reports?.some((r) => r.id === b.reportId && !r.resolved))
        throw fail('report_state_conflict', 409);
      if (
        (action === 'approve' && i.status !== 'pending') ||
        (hide && i.status !== 'published') ||
        (action === 'withdraw' && !['published', 'pending'].includes(i.status))
      )
        throw fail('source_state_conflict', 409);
      const targetStatus = restore || action === 'approve' ? 'published' : 'withdrawn';
      i.communityPending = {
        ...b,
        hash: fingerprint,
        targetStatus,
        displayStatus: hide ? 'hidden' : targetStatus,
        targetRevision: i.revision + (i.status === 'pending' && action === 'withdraw' ? 0 : 1),
      };
      await save(i);
      if (action === 'approve' || (restore && i.status === 'pending'))
        await handlers.approve({ body: b });
      else if (i.status === 'pending') {
        await posts.removeFromQueue(i.queueId);
        i.status = 'withdrawn';
        await save(i);
      } else {
        const uid = await bind(who);
        i.intent = { action: restore ? 'community-restore' : 'withdraw', actor: who.userId };
        await save(i);
        if (restore) {
          if (i.parentId && (await item(i.parentId)).status !== 'published')
            throw fail('parent_unavailable', 409);
          await posts.restore(i.pid, uid);
          if (!i.parentId) await topics.setTopicField(i.tid, 'deleted', 0);
        } else {
          await posts.delete(i.pid, uid);
          if (!i.parentId) await topics.setTopicField(i.tid, 'deleted', 1);
        }
        delete i.intent;
        await event(i, targetStatus, who.userId);
      }
      const changed = await item(i.id);
      if (!(await finish(changed))) throw fail('source_needs_reconciliation', 409);
      return changed.communityRequests[b.requestId].result;
    }
    trail(i, b, action);
    i.communityRequests ||= {};
    const result = summary(i);
    i.communityRequests[b.requestId] = { hash: fingerprint, result };
    await save(i);
    return result;
  });
  return {
    async recover() {
      for (const id of await db.getSortedSetRange('hd:items', 0, -1)) {
        const i = await item(id);
        await finish(i);
        if (i.community && !i.intent && !['preparing', 'rejected'].includes(i.status)) {
          const mapping = await read('hd:community:source-draft:' + id),
            d = mapping && (await read('hd:community:draft:' + mapping.draftId));
          if (d?.status === 'draft' && d.submitRequest) {
            d.status = 'submitted';
            await write('hd:community:draft:' + d.draftId, d);
          }
        }
      }
    },
  };
};
