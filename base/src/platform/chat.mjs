import { randomUUID } from 'node:crypto';
import { problem, hash } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { fields, canonical } from '../protocol/index.mjs';
import { request } from './services.mjs';
import {
  assertContactConsent,
  contactPermission,
  contactReceipt,
  withContactGuard,
} from './contacts.mjs';
const uuid = (s) =>
  typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const cursor = (s = 0) => {
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) throw problem('cursor_invalid');
  return n;
};
export function createChat(db, identity, services, config) {
  const streams = new Map();
  const native = async (school, action, id, extra = {}) => {
    const s = services.school(school);
    const r = await request(
      s.nakamaUrl + '/v2/rpc/hd_message?http_key=' + encodeURIComponent(s.nakamaHttpKey),
      {
        method: 'POST',
        body: JSON.stringify(JSON.stringify({ key: s.nakamaKey, action, id, ...extra })),
      },
    );
    return JSON.parse(r.payload);
  };
  async function access(
    school,
    id,
    user,
    c = db.pool,
    { allowBlocked = config.campusEnabled === true } = {},
  ) {
    if (!uuid(id)) throw problem('conversation_missing', 404);
    const {
      rows: [v],
    } = await c.query('SELECT * FROM hd_conversations WHERE school_id=$1 AND conversation_id=$2', [
      school,
      id,
    ]);
    if (!v || (v.kind === 'dm' && !v.participants.includes(user)))
      throw problem('conversation_denied', 403);
    await scope(db, school, user, v.org_id, 'read', c);
    if (v.kind === 'dm') {
      for (const p of v.participants) await scope(db, school, p, v.org_id, 'read', c);
      if (
        !allowBlocked &&
        (
          await c.query(
            'SELECT 1 FROM hd_chat_blocks WHERE school_id=$1 AND ((user_id=$2 AND blocked_id=$3) OR (user_id=$3 AND blocked_id=$2))',
            [school, ...v.participants],
          )
        ).rowCount
      )
        throw problem('conversation_blocked', 403);
    }
    return v;
  }
  async function finish(op, m, n, tx = db.tx) {
    if (n.missing || n.value.operationId !== op.operation_id) return false;
    if (
      n.value.inputHash !== op.input_hash ||
      n.value.revision !== op.expected_revision + 1 ||
      n.value.messageId !== m.message_id ||
      n.value.conversationId !== m.conversation_id
    )
      throw problem('message_source_conflict', 409);
    return tx(async (c) => {
      const {
        rows: [locked],
      } = await c.query('SELECT * FROM hd_chat_operations WHERE operation_id=$1 FOR UPDATE', [
        op.operation_id,
      ]);
      if (locked.state === 'committed') return locked.result;
      const status = n.value.status;
      await c.query(
        'UPDATE hd_chat_messages SET revision=$2,native_version=$3,status=$4 WHERE message_id=$1',
        [m.message_id, n.value.revision, n.version, status],
      );
      const {
        rows: [ev],
      } = await c.query(
        'INSERT INTO hd_chat_events(conversation_id,message_id,revision,status) VALUES($1,$2,$3,$4) RETURNING sequence',
        [m.conversation_id, m.message_id, n.value.revision, status],
      );
      const result = {
        messageId: m.message_id,
        revision: n.value.revision,
        status,
        sequence: ev.sequence,
      };
      await c.query(
        "UPDATE hd_chat_operations SET state='committed',result=$2 WHERE operation_id=$1",
        [op.operation_id, result],
      );
      await audit(
        c,
        m.school_id,
        op.action === 'expire' ? null : op.user_id,
        'chat.' + op.action,
        m.message_id,
        {
          conversationId: m.conversation_id,
          revision: result.revision,
          actorKind: op.action === 'expire' ? 'system' : 'human',
        },
      );
      return result;
    });
  }
  // A source write can commit before a Base receipt. Recover from the stored operation ID, never resend blindly.
  async function reconcile(school) {
    const { rows } = await db.pool.query(
      "SELECT o.*,m.conversation_id,m.sender_id FROM hd_chat_operations o JOIN hd_chat_messages m USING(message_id) WHERE o.school_id=$1 AND o.state='pending' ORDER BY o.operation_id LIMIT 100",
      [school],
    );
    const recovered = [],
      blocked = [];
    for (const op of rows) {
      const n = await native(school, 'get', op.message_id);
      if (await finish(op, op, n)) recovered.push(op.message_id);
      else blocked.push({ messageId: op.message_id, reason: 'original_request_retry_required' });
    }
    return { recovered, blocked };
  }
  async function content(m) {
    if (
      m.status === 'deleted' ||
      m.status === 'expired' ||
      (m.expires_at && m.expires_at <= Date.now())
    )
      return { text: null, status: m.status === 'deleted' ? 'deleted' : 'expired' };
    const n = await native(m.school_id, 'get', m.message_id);
    if (n.missing || n.value.revision !== m.revision || n.version !== m.native_version)
      throw problem('message_reconciliation_required', 409);
    return { text: n.value.text, status: n.value.status };
  }
  async function page(school, id, user, after) {
    const v = await access(school, id, user);
    const { rows } = await db.pool.query(
      `SELECT e.sequence,m.*,u.display_name FROM hd_chat_events e JOIN hd_chat_messages m USING(message_id) JOIN hd_users u ON u.user_id=m.sender_id WHERE e.conversation_id=$1 AND e.sequence>$2 ORDER BY e.sequence LIMIT 100`,
      [id, after],
    );
    const items = [];
    for (const e of rows)
      items.push({
        messageId: e.message_id,
        sequence: e.sequence,
        revision: e.revision,
        senderId: e.sender_id,
        name: e.display_name,
        createdAt: e.created_at,
        ...(await content(e)),
      });
    // Re-check after upstream reads, so a permission change during fetch is not sent to the client.
    await access(school, id, user);
    const { rows: reads } = await db.pool.query(
      'SELECT user_id,last_sequence FROM hd_chat_reads WHERE conversation_id=$1 AND ($2 OR user_id=$3)',
      [id, v.kind === 'dm', user],
    );
    const permission =
      config.campusEnabled && v.kind === 'dm'
        ? await contactPermission(
            db,
            school,
            user,
            v.participants.find((p) => p !== user),
            v.org_id,
          )
        : { canSend: true, reason: null };
    return {
      conversationId: id,
      items,
      cursor: rows.at(-1)?.sequence || String(after),
      reads,
      canSend: permission.canSend,
      contactPermission: config.campusEnabled && v.kind === 'dm' ? permission : null,
    };
  }
  async function write(school, id, user, b) {
    if (
      !['send', 'edit', 'remove'].includes(b.action) ||
      !/^[a-zA-Z0-9._:-]{1,128}$/.test(b.requestId || '')
    )
      throw problem('message_input_invalid');
    if (
      b.action !== 'remove' &&
      (typeof b.text !== 'string' || b.text.trim().length < 1 || b.text.length > 4000)
    )
      throw problem('message_text_invalid');
    if (
      b.action !== 'send' &&
      (!uuid(b.messageId) || !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1)
    )
      throw problem('message_revision_required');
    const fingerprint = hash(canonical({ conversationId: id, ...b }));
    const execute = async (client, tx) => {
      const op = await tx(async (c) => {
        const conversation = await access(school, id, user, c);
        if (config.campusEnabled && conversation.kind === 'dm' && b.action !== 'remove')
          await assertContactConsent(
            db,
            school,
            user,
            conversation.participants.find((p) => p !== user),
            conversation.org_id,
            c,
          );
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          school + ':chat-rate:' + user,
        ]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          school + ':chat:' + user + ':' + b.requestId,
        ]);
        const {
          rows: [old],
        } = await c.query(
          'SELECT * FROM hd_chat_operations WHERE school_id=$1 AND user_id=$2 AND request_id=$3',
          [school, user, b.requestId],
        );
        if (old) {
          if (old.input_hash !== fingerprint) throw problem('request_conflict', 409);
          return old;
        }
        let m;
        if (b.action === 'send') {
          const {
            rows: [rate],
          } = await c.query(
            "SELECT count(*)::int AS n FROM hd_chat_operations WHERE school_id=$1 AND user_id=$2 AND action='send' AND message_id IN (SELECT message_id FROM hd_chat_messages WHERE created_at>now()-interval '1 minute')",
            [school, user],
          );
          if (rate.n >= 30) throw problem('chat_rate_limited', 429);
          const ttl = config.chatRetentionDays;
          if (ttl !== undefined && (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 3650))
            throw problem('retention_configuration_invalid', 503);
          ({
            rows: [m],
          } = await c.query(
            'INSERT INTO hd_chat_messages(message_id,conversation_id,school_id,sender_id,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [randomUUID(), id, school, user, ttl ? new Date(Date.now() + ttl * 86400000) : null],
          ));
        } else {
          ({
            rows: [m],
          } = await c.query(
            'SELECT * FROM hd_chat_messages WHERE message_id=$1 AND conversation_id=$2 FOR UPDATE',
            [b.messageId, id],
          ));
          if (!m || m.sender_id !== user) throw problem('message_author_required', 403);
          if (
            m.revision !== b.expectedRevision ||
            m.status !== 'active' ||
            (m.expires_at && m.expires_at <= Date.now())
          )
            throw problem('message_write_conflict', 409);
          if (m.legal_hold) throw problem('message_legal_hold', 409);
          if (
            (
              await c.query(
                "SELECT 1 FROM hd_chat_operations WHERE message_id=$1 AND state='pending'",
                [m.message_id],
              )
            ).rowCount
          )
            throw problem('message_reconciliation_required', 409);
        }
        const {
          rows: [created],
        } = await c.query(
          'INSERT INTO hd_chat_operations(operation_id,school_id,user_id,request_id,message_id,action,input_hash,expected_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [
            randomUUID(),
            school,
            user,
            b.requestId,
            m.message_id,
            b.action,
            fingerprint,
            m.revision,
          ],
        );
        return created;
      });
      if (op.state === 'committed') return op.result;
      const {
        rows: [m],
      } = await client.query('SELECT * FROM hd_chat_messages WHERE message_id=$1', [op.message_id]);
      // Idempotent server storage CAS: same operation returns the same source record.
      const n = await native(school, 'put', m.message_id, {
        expectedVersion: m.native_version,
        value: {
          schema: 'hyper-dimension.message/v1',
          schoolId: school,
          conversationId: id,
          messageId: m.message_id,
          actor: { kind: 'human', userId: user },
          onBehalfOf: null,
          operationId: op.operation_id,
          inputHash: fingerprint,
          revision: op.expected_revision + 1,
          status: b.action === 'remove' ? 'deleted' : 'active',
          text: b.action === 'remove' ? null : b.text,
        },
      });
      return finish(op, m, n, tx);
    };
    return config.campusEnabled ? withContactGuard(db, school, execute) : execute(db.pool, db.tx);
  }
  async function handle(req, res, { url, json, body }) {
    const p = url.pathname.split('/').filter(Boolean);
    if (
      p[0] !== 'm1' ||
      p[1] !== 'schools' ||
      !['chat', 'contacts', 'blocks', 'reports'].includes(p[3])
    )
      return false;
    if (!['GET', 'POST'].includes(req.method)) throw problem('method_denied', 405);
    const user = (await identity.user(req)).user_id,
      school = services.school(p[2]).schoolId;
    await db.member(school, user);
    const org = url.searchParams.get('org') || null,
      kind = p[3];
    if (kind === 'contacts' && req.method === 'GET') {
      await scope(db, school, user, org);
      const { rows } = await db.pool.query(
        org
          ? `SELECT u.user_id,u.display_name FROM hd_users u JOIN hd_memberships m ON m.user_id=u.user_id JOIN hd_org_members o ON o.user_id=u.user_id AND o.school_id=m.school_id WHERE m.school_id=$1 AND o.org_id=$2 AND o.active AND m.active AND u.enabled ORDER BY u.display_name LIMIT 200`
          : `SELECT u.user_id,u.display_name FROM hd_users u JOIN hd_memberships m USING(user_id) WHERE m.school_id=$1 AND m.active AND u.enabled AND m.role NOT IN ('affiliate','partner') ORDER BY u.display_name LIMIT 200`,
        org ? [school, org] : [school],
      );
      json(res, 200, { contacts: rows, requiresContactConsent: config.campusEnabled === true });
      return true;
    }
    if (kind === 'blocks') {
      if (req.method === 'GET')
        json(res, 200, {
          blocks: (
            await db.pool.query(
              'SELECT blocked_id FROM hd_chat_blocks WHERE school_id=$1 AND user_id=$2',
              [school, user],
            )
          ).rows,
        });
      else {
        const b = fields(await body(req), ['userId', 'blocked'], 'block');
        if (!uuid(b.userId) || b.userId === user || typeof b.blocked !== 'boolean')
          throw problem('block_invalid');
        await db.tx(async (c) => {
          if (config.campusEnabled) {
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              school + ':permissions',
            ]);
            await db.member(school, user, null, c);
          }
          if (
            !(
              await c.query('SELECT 1 FROM hd_memberships WHERE school_id=$1 AND user_id=$2', [
                school,
                b.userId,
              ])
            ).rowCount
          )
            throw problem('block_target_denied', 403);
          if (b.blocked)
            await c.query('INSERT INTO hd_chat_blocks VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
              school,
              user,
              b.userId,
            ]);
          else
            await c.query(
              'DELETE FROM hd_chat_blocks WHERE school_id=$1 AND user_id=$2 AND blocked_id=$3',
              [school, user, b.userId],
            );
          await audit(c, school, user, 'chat.block', b.userId, { blocked: b.blocked });
        });
        json(res, 200, { blocked: b.blocked });
      }
      return true;
    }
    if (kind === 'reports') {
      await scope(db, school, user, org, 'moderate');
      if (req.method === 'GET') {
        const { rows } = await db.pool.query(
          'SELECT r.*,m.conversation_id FROM hd_chat_reports r JOIN hd_chat_messages m USING(message_id) JOIN hd_conversations v USING(conversation_id) WHERE r.school_id=$1 AND v.org_id IS NOT DISTINCT FROM $2 ORDER BY r.created_at DESC LIMIT 100',
          [school, org],
        );
        json(res, 200, { reports: rows });
        return true;
      }
      const b = fields(await body(req), ['reportId', 'reason', 'resolve'], 'review');
      if (
        !uuid(b.reportId) ||
        typeof b.reason !== 'string' ||
        b.reason.trim().length < 3 ||
        b.reason.length > 500
      )
        throw problem('review_reason_required');
      const {
        rows: [r],
      } = await db.pool.query(
        'SELECT m.*,r.report_id FROM hd_chat_reports r JOIN hd_chat_messages m USING(message_id) JOIN hd_conversations v USING(conversation_id) WHERE r.report_id=$1 AND r.school_id=$2 AND v.org_id IS NOT DISTINCT FROM $3',
        [b.reportId, school, org],
      );
      if (!r) throw problem('report_scope_denied', 403);
      await audit(db.pool, school, user, 'chat.report.review', r.message_id, {
        reportId: b.reportId,
        reason: b.reason,
      });
      if (b.resolve === true)
        await db.pool.query(
          'UPDATE hd_chat_reports SET resolved_at=now(),resolution=$2 WHERE report_id=$1',
          [b.reportId, b.reason],
        );
      json(res, 200, { messageId: r.message_id, ...(await content(r)) });
      return true;
    }
    if (!p[4]) {
      if (req.method === 'GET') {
        const { rows } = await db.pool.query(
          "SELECT * FROM hd_conversations WHERE school_id=$1 AND (kind='room' OR $2=ANY(participants)) ORDER BY created_at DESC LIMIT 200",
          [school, user],
        );
        const conversations = [];
        for (const v of rows)
          try {
            await access(school, v.conversation_id, user);
            const {
              rows: [n],
            } = await db.pool.query(
              'SELECT count(DISTINCT e.message_id)::int AS unread FROM hd_chat_events e JOIN hd_chat_messages m USING(message_id) WHERE e.conversation_id=$1 AND e.sequence>coalesce((SELECT last_sequence FROM hd_chat_reads WHERE conversation_id=$1 AND user_id=$2),0) AND m.sender_id<>$2',
              [v.conversation_id, user],
            );
            const permission =
              config.campusEnabled && v.kind === 'dm'
                ? await contactPermission(
                    db,
                    school,
                    user,
                    v.participants.find((p) => p !== user),
                    v.org_id,
                  )
                : { canSend: true };
            conversations.push({
              ...v,
              unread: n.unread,
              canSend: permission.canSend,
              contactPermission: config.campusEnabled && v.kind === 'dm' ? permission : null,
            });
          } catch (e) {
            if (e.status !== 403) throw e;
          }
        json(res, 200, { conversations });
        return true;
      }
      const b = fields(await body(req), ['requestId', 'kind', 'orgId', 'peerId'], 'conversation');
      if (
        !['dm', 'room'].includes(b.kind) ||
        (b.kind === 'dm' && (!uuid(b.peerId) || b.peerId === user))
      )
        throw problem('conversation_input_invalid');
      const scopeOrg = b.orgId || null;
      await scope(db, school, user, scopeOrg);
      if (b.kind === 'dm') await scope(db, school, b.peerId, scopeOrg);
      const participants = b.kind === 'dm' ? [user, b.peerId].sort() : [];
      const scopeKey = JSON.stringify([scopeOrg, b.kind, participants]);
      const create = async (c) => {
        await c.query(
          'INSERT INTO hd_conversations VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(school_id,scope_key) DO NOTHING',
          [randomUUID(), school, scopeOrg, b.kind, participants, scopeKey],
        );
        const {
          rows: [v],
        } = await c.query('SELECT * FROM hd_conversations WHERE school_id=$1 AND scope_key=$2', [
          school,
          scopeKey,
        ]);
        await access(school, v.conversation_id, user, c);
        return { conversationId: v.conversation_id, kind: v.kind };
      };
      const r = config.campusEnabled
        ? await db.tx(async (c) => {
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              school + ':permissions',
            ]);
            await scope(db, school, user, scopeOrg, 'read', c);
            if (b.kind === 'dm')
              await assertContactConsent(db, school, user, b.peerId, scopeOrg, c);
            return contactReceipt(c, school, user, url.pathname, b, () => create(c));
          })
        : await db.receipt(school, user, b.requestId, b, create);
      await access(school, r.conversationId, user);
      json(res, 200, r);
      return true;
    }
    const id = p[4],
      v = await access(school, id, user);
    if (p[5] === 'stream' && req.method === 'GET') {
      const key = school + ':' + user;
      if (
        (streams.get(key)?.size || 0) >= 3 ||
        [...streams.values()].reduce((n, s) => n + s.size, 0) >= 200
      )
        throw problem('stream_limit', 429);
      let after = cursor(req.headers['last-event-id'] || url.searchParams.get('after') || 0),
        closed = false,
        timer;
      const set = streams.get(key) || new Set();
      streams.set(key, set);
      set.add(res);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        set.delete(res);
        if (!set.size) streams.delete(key);
        res.end();
      };
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      res.on('close', stop);
      const pump = async () => {
        try {
          const fresh = await identity.user(req);
          if (fresh.user_id !== user) throw problem('identity_changed', 403);
          const result = await page(school, id, user, after);
          if (closed) return;
          after = result.cursor;
          if (!res.write(`id: ${after}\nevent: sync\ndata: ${JSON.stringify(result)}\n\n`))
            return stop();
          timer = setTimeout(pump, 1000);
          timer.unref();
        } catch (e) {
          if (closed) return;
          if ([401, 403].includes(e.status)) {
            res.write('event: denied\ndata: {"error":"session_or_scope_unavailable"}\n\n');
            stop();
          } else {
            res.write('event: retry\ndata: {"error":"source_temporarily_unavailable"}\n\n');
            timer = setTimeout(pump, 2000);
            timer.unref();
          }
        }
      };
      pump();
      return true;
    }
    if (p[5] === 'messages') {
      if (req.method === 'GET')
        json(res, 200, await page(school, id, user, cursor(url.searchParams.get('after') || 0)));
      else
        json(
          res,
          200,
          await write(
            school,
            id,
            user,
            fields(
              await body(req),
              ['action', 'requestId', 'messageId', 'expectedRevision', 'text'],
              'message',
            ),
          ),
        );
      return true;
    }
    if (p[5] === 'read' && req.method === 'POST') {
      const b = fields(await body(req), ['sequence'], 'read'),
        seq = cursor(b.sequence);
      if (
        seq &&
        !(
          await db.pool.query(
            'SELECT 1 FROM hd_chat_events WHERE conversation_id=$1 AND sequence=$2',
            [id, seq],
          )
        ).rowCount
      )
        throw problem('read_cursor_scope_denied', 403);
      await db.pool.query(
        'INSERT INTO hd_chat_reads VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_sequence=greatest(hd_chat_reads.last_sequence,EXCLUDED.last_sequence)',
        [id, user, seq],
      );
      json(res, 200, { readThrough: String(seq) });
      return true;
    }
    if (p[5] === 'report' && req.method === 'POST') {
      const b = fields(await body(req), ['messageId', 'reason'], 'report');
      if (
        !uuid(b.messageId) ||
        typeof b.reason !== 'string' ||
        !b.reason.trim() ||
        b.reason.length > 500
      )
        throw problem('report_invalid');
      const {
        rows: [m],
      } = await db.pool.query(
        'SELECT * FROM hd_chat_messages WHERE conversation_id=$1 AND message_id=$2 AND revision>0',
        [id, b.messageId],
      );
      if (!m) throw problem('message_missing', 404);
      const {
        rows: [report],
      } = await db.pool.query(
        'INSERT INTO hd_chat_reports(report_id,school_id,message_id,reporter_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id,reporter_id) DO UPDATE SET reason=hd_chat_reports.reason RETURNING report_id',
        [randomUUID(), school, b.messageId, user, b.reason],
      );
      json(res, 200, report);
      return true;
    }
    throw problem('route_missing', 404);
  }
  async function expire(school, { apply = false } = {}) {
    const { rows } = await db.pool.query(
      "SELECT message_id,revision,legal_hold FROM hd_chat_messages WHERE school_id=$1 AND status='active' AND expires_at<=now() ORDER BY expires_at LIMIT 100",
      [school],
    );
    if (!apply) return { candidates: rows, applied: false };
    const expired = [],
      held = [];
    for (const candidate of rows) {
      if (candidate.legal_hold) {
        held.push(candidate.message_id);
        continue;
      }
      const r = await db.tx(async (c) => {
        const {
          rows: [m],
        } = await c.query('SELECT * FROM hd_chat_messages WHERE message_id=$1 FOR UPDATE', [
          candidate.message_id,
        ]);
        if (m.status !== 'active' || m.legal_hold || m.expires_at > Date.now()) return null;
        if (
          (
            await c.query(
              "SELECT 1 FROM hd_chat_operations WHERE message_id=$1 AND state='pending'",
              [m.message_id],
            )
          ).rowCount
        )
          return null;
        const inputHash = hash(['expire', m.message_id, m.revision]),
          requestId = 'retention:' + m.message_id + ':' + m.revision;
        const {
          rows: [op],
        } = await c.query(
          "INSERT INTO hd_chat_operations(operation_id,school_id,user_id,request_id,message_id,action,input_hash,expected_revision) VALUES($1,$2,$3,$4,$5,'expire',$6,$7) RETURNING *",
          [randomUUID(), school, m.sender_id, requestId, m.message_id, inputHash, m.revision],
        );
        return { m, op };
      });
      if (!r) continue;
      const { m, op } = r;
      const n = await native(school, 'put', m.message_id, {
        expectedVersion: m.native_version,
        value: {
          schema: 'hyper-dimension.message/v1',
          schoolId: school,
          conversationId: m.conversation_id,
          messageId: m.message_id,
          actor: { kind: 'system', id: 'retention' },
          onBehalfOf: null,
          operationId: op.operation_id,
          inputHash: op.input_hash,
          revision: m.revision + 1,
          status: 'expired',
          text: null,
        },
      });
      await finish(op, m, n);
      expired.push(m.message_id);
    }
    return { expired, held, applied: true };
  }
  return {
    handle,
    reconcile,
    expire,
    close() {
      for (const set of streams.values()) for (const r of set) r.end();
      streams.clear();
    },
  };
}
