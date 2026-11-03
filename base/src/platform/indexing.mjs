import { hash, problem } from './db.mjs';
import { scope, audit } from './permissions.mjs';
import { fields, canonical } from '../protocol/index.mjs';
import { prepareDocuments } from '../knowledge/index.mjs';
import { createModulePolicy } from './modules.mjs';
const generation = (head, model) =>
  hash(
    canonical({
      head: {
        id: head.id,
        revision: head.revision,
        scopeId: head.scopeId,
        parentId: head.parentId,
        published: head.published,
        contentHash: head.contentHash,
      },
      model,
    }),
  );
export function createIndexing(db, identity, services, config, jobs) {
  const policy = createModulePolicy(config);
  let knowledge;
  const need = () => {
    if (!knowledge) throw problem('vector_index_unavailable', 503);
    return knowledge;
  };
  const latest = async (school, c = db.pool) =>
    (
      await c.query(
        'SELECT * FROM hd_knowledge_snapshots WHERE school_id=$1 ORDER BY version DESC LIMIT 1',
        [school],
      )
    ).rows[0];
  async function enqueue(c, kind, school, sourceId, desired) {
    const old = (
      await c.query(
        'SELECT desired_hash FROM hd_index_sources WHERE school_id=$1 AND kind=$2 AND source_id=$3',
        [school, kind, sourceId],
      )
    ).rows[0];
    if (old?.desired_hash === desired) return;
    const job = await jobs.scheduleIndex(c, kind, {
      schoolId: school,
      sourceId,
      generation: desired,
    });
    await c.query(
      `INSERT INTO hd_index_sources(school_id,kind,source_id,desired_hash,job_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(school_id,kind,source_id) DO UPDATE SET desired_hash=$4,job_id=$5,complete=false,updated_at=now()`,
      [school, kind, sourceId, desired, job.jobId],
    );
  }
  return {
    bind(k) {
      knowledge = k;
      k?.setSourceValidator(async (spaceId, found) => {
        const school = config.schools.find((s) => s.spaceId === spaceId);
        if (!school) return [];
        const snapshot = await latest(school.schoolId);
        if (!snapshot) return found;
        const chunks = prepareDocuments(snapshot.documents).chunks;
        return found.filter((f) =>
          chunks.some(
            (c) =>
              c.documentId === f.documentId &&
              c.revision === f.revision &&
              c.id === f.id &&
              c.body === f.body,
          ),
        );
      });
    },
    async reconcile(schoolId) {
      if (!knowledge) return { configured: false };
      const school = services.school(schoolId),
        snapshot = await latest(schoolId);
      if (snapshot)
        await db.tx((c) =>
          enqueue(
            c,
            'knowledge-index',
            schoolId,
            'public',
            hash([snapshot.version, knowledge.embeddingIdentity]),
          ),
        );
      if (!policy.forSchool(schoolId).base3) return;
      let after = '';
      do {
        const page = await services.forum(school, 'index-inventory', { after, limit: 100 });
        for (const head of page.items)
          await db.tx((c) =>
            enqueue(
              c,
              'forum-index',
              schoolId,
              head.id,
              generation(head, knowledge.embeddingIdentity),
            ),
          );
        after = page.next;
      } while (after);
      return { configured: true };
    },
    async workPublic(data) {
      const k = need(),
        school = services.school(data.schoolId),
        s = await latest(data.schoolId);
      if (!s || data.generation !== hash([s.version, k.embeddingIdentity]))
        return { obsolete: true };
      await k.import(school.spaceId, s.documents, { replace: true });
      const current = await latest(data.schoolId);
      if (current.version !== s.version) return { obsolete: true };
      await db.pool.query(
        "UPDATE hd_index_sources SET indexed_hash=$3,indexed_revision=$4,model_key=$5,complete=true,updated_at=now() WHERE school_id=$1 AND kind='knowledge-index' AND source_id=$2 AND desired_hash=$3",
        [data.schoolId, 'public', data.generation, s.version, k.embeddingIdentity],
      );
      return { version: s.version };
    },
    async workForum(data) {
      const k = need(),
        school = services.school(data.schoolId);
      // A single source is serialized across processes. A batch records its checkpoint and continuation together.
      const lock = await db.pool.connect(),
        key = 'forum-vector:' + data.schoolId + ':' + data.sourceId;
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      try {
        const state = (
          await lock.query(
            "SELECT * FROM hd_index_sources WHERE school_id=$1 AND kind='forum-index' AND source_id=$2",
            [data.schoolId, data.sourceId],
          )
        ).rows[0];
        if (!state || state.desired_hash !== data.generation) return { obsolete: true };
        if (state.complete && state.indexed_hash === data.generation) return { reused: true };
        const reset = state.model_key !== k.embeddingIdentity || !state.indexed_hash;
        const source = await services.forum(school, 'index-source', {
          id: data.sourceId,
          afterRevision: reset ? 0 : state.indexed_revision,
        });
        if (generation(source, k.embeddingIdentity) !== data.generation) return { obsolete: true };
        await k.forum.apply(school.spaceId, source, data.generation, { reset });
        const after = await services.forum(school, 'index-source', {
          id: data.sourceId,
          headOnly: true,
        });
        if (generation(after, k.embeddingIdentity) !== data.generation) return { obsolete: true };
        const cursor = source.published
          ? source.versions.at(-1)?.revision || state.indexed_revision
          : 0;
        await db.tx(async (c) => {
          let jobId = state.job_id;
          if (source.hasMore)
            jobId = (await jobs.scheduleIndex(c, 'forum-index', { ...data, cursor })).jobId;
          await c.query(
            "UPDATE hd_index_sources SET indexed_hash=$3,indexed_revision=$4,model_key=$5,job_id=$6,complete=$7,updated_at=now() WHERE school_id=$1 AND kind='forum-index' AND source_id=$2 AND desired_hash=$3",
            [
              data.schoolId,
              data.sourceId,
              data.generation,
              cursor,
              k.embeddingIdentity,
              jobId,
              !source.hasMore,
            ],
          );
        });
        return { revision: cursor, more: source.hasMore };
      } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
        lock.release();
      }
    },
    async handle(req, res, { url, json, body }) {
      const p = url.pathname.split('/').filter(Boolean);
      if (!['knowledge-admin', 'history-index'].includes(p[0])) return false;
      if (p[1] !== 'schools' || !p[2]) throw problem('index_route_missing', 404);
      const school = services.school(p[2]),
        user = (await identity.user(req)).user_id;
      if (p[0] === 'history-index' && p[3] === 'search' && req.method === 'POST') {
        const input = fields(
          await body(req),
          ['query', 'orgId', 'includeHistory'],
          'history_search',
        );
        if (
          typeof input.query !== 'string' ||
          !input.query.trim() ||
          input.query.length > 2000 ||
          (input.includeHistory !== undefined && typeof input.includeHistory !== 'boolean')
        )
          throw problem('history_search_invalid');
        const result = await db.tx(async (c) => {
          await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
            school.schoolId + ':permissions',
          ]);
          await scope(db, school.schoolId, user, input.orgId || null, 'read', c);
          const candidates = await need().forum.search(
              school.spaceId,
              input.orgId || '',
              input.query,
              { includeHistory: input.includeHistory === true, limit: 40 },
            ),
            items = [];
          for (const r of candidates) {
            const source = await services.forum(school, 'index-source', {
              id: r.sourceId,
              headOnly: true,
            });
            if (
              !source.published ||
              source.scopeId !== (input.orgId || '') ||
              generation(source, knowledge.embeddingIdentity) !== r.sourceHash
            )
              continue;
            items.push({
              ...r,
              historical: r.revision !== source.revision,
              currentRevision: source.revision,
            });
            if (items.length === 8) break;
          }
          await scope(db, school.schoolId, user, input.orgId || null, 'read', c);
          return {
            items,
            includeHistory: input.includeHistory === true,
            privateForumIndex: true,
            source: 'nodebb-reviewed-revisions',
          };
        });
        json(res, 200, result);
        return true;
      }
      await scope(db, school.schoolId, user, null, 'manage');
      if (p[0] === 'knowledge-admin' && p[3] === 'documents' && req.method === 'GET') {
        const snapshot = await latest(school.schoolId);
        json(res, 200, { version: snapshot?.version || 0, documents: snapshot?.documents || [] });
        return true;
      }
      if (p[3] === 'status' && req.method === 'GET') {
        const s = await latest(school.schoolId);
        json(res, 200, {
          configured: Boolean(knowledge),
          publicVersion: s?.version || 0,
          sources: (
            await db.pool.query(
              'SELECT kind,source_id,(desired_hash=indexed_hash AND complete) AS current,indexed_revision,job_id,updated_at FROM hd_index_sources WHERE school_id=$1 ORDER BY kind,source_id',
              [school.schoolId],
            )
          ).rows,
        });
        return true;
      }
      if (p[0] !== 'knowledge-admin' || p[3] !== 'documents' || req.method !== 'POST')
        throw problem('index_route_missing', 404);
      const input = fields(
        await body(req),
        ['requestId', 'expectedVersion', 'documents', 'confirmed'],
        'reviewed_knowledge',
      );
      if (
        input.confirmed !== true ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0 ||
        !Array.isArray(input.documents)
      )
        throw problem('reviewed_snapshot_required');
      const documents = input.documents
        .map((d) =>
          fields(
            d,
            ['id', 'title', 'body', 'revision', 'sourceLabel', 'sceneId', 'entityId', 'published'],
            'reviewed_document',
          ),
        )
        .filter((d) => d.published === true);
      prepareDocuments(documents);
      const result = await db.receipt(
        school.schoolId,
        user,
        input.requestId,
        { route: url.pathname, input },
        async (c) => {
          await scope(db, school.schoolId, user, null, 'manage', c);
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            school.schoolId + ':knowledge-publication',
          ]);
          const old = await latest(school.schoolId, c);
          if ((old?.version || 0) !== input.expectedVersion)
            throw problem('revision_conflict', 409);
          const version = input.expectedVersion + 1;
          const previous = (
            await c.query(
              `SELECT DISTINCT ON (d->>'id') d AS document
          FROM hd_knowledge_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.documents) d
          WHERE s.school_id=$1 ORDER BY d->>'id',s.version DESC`,
              [school.schoolId],
            )
          ).rows;
          const normalized = documents.map((d) => {
            const old = previous.find((x) => x.document.id === d.id)?.document;
            const oldRevision = Number.isSafeInteger(old?.revision) ? old.revision : 1;
            const content = (x) => {
              const { revision, ...rest } = x;
              return canonical(rest);
            };
            return {
              ...d,
              revision: old ? (content(old) === content(d) ? oldRevision : oldRevision + 1) : 1,
            };
          });
          await c.query(
            'INSERT INTO hd_knowledge_snapshots(school_id,version,documents,actor_id) VALUES($1,$2,$3,$4)',
            [school.schoolId, version, JSON.stringify(normalized), user],
          );
          const k = need();
          await enqueue(
            c,
            'knowledge-index',
            school.schoolId,
            'public',
            hash([version, k.embeddingIdentity]),
          );
          await audit(c, school.schoolId, user, 'knowledge.reviewed_snapshot', String(version), {
            documents: documents.length,
          });
          return {
            version,
            documents: documents.length,
            indexing: 'queued',
            privateForumIncluded: false,
          };
        },
        (c) => scope(db, school.schoolId, user, null, 'manage', c),
      );
      json(res, 200, result);
      return true;
    },
  };
}
