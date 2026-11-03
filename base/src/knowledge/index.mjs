import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { authorize, identifier, text, digest, fail } from '../protocol/index.mjs';
import { createEmbedding } from './embedding.mjs';
import { openKnowledgeDatabase } from './database.mjs';
import { createForumVector } from './forum.mjs';

export function prepareDocuments(input) {
  if (!Array.isArray(input) || input.length > 1000)
    fail('knowledge_input', 'Expected an array of at most 1000 documents');
  const chunks = [],
    ids = new Set();
  let excluded = 0;
  for (const d of input) {
    if (d.published !== true) {
      excluded++;
      continue;
    }
    identifier(d.id, 'documentId');
    if (d.id.length > 80 || ids.has(d.id))
      fail('knowledge_input', 'Duplicate or oversized document ID');
    ids.add(d.id);
    const title = text(d.title, 100),
      body = text(d.body, 100000),
      label = text(d.sourceLabel || title, 200);
    const revision = d.revision || 1;
    if (!Number.isSafeInteger(revision) || revision < 1)
      fail('knowledge_input', 'Document revision must be a positive integer');
    if (d.sceneId) identifier(d.sceneId);
    if (d.entityId) identifier(d.entityId);
    for (let offset = 0, index = 0; offset < body.length; offset += 300, index++) {
      const part = body.slice(offset, offset + 350);
      chunks.push({
        id: `kb:${d.id}:${index}-${digest(part).slice(0, 8)}`,
        documentId: d.id,
        title,
        body: part,
        revision,
        sourceLabel: label,
        sceneId: d.sceneId || null,
        entityId: d.entityId || null,
      });
      if (offset + 350 >= body.length) break;
    }
  }
  if (chunks.length > 5000)
    fail('knowledge_input', 'At most 5000 chunks per space in this reference import');
  return { chunks, excluded, documents: ids.size };
}
export async function loadKnowledgeConfig(dataDir) {
  try {
    return JSON.parse(
      (await readFile(join(dataDir, 'knowledge.json'), 'utf8')).replace(/^\uFEFF/, ''),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export async function openKnowledge({
  dataDir,
  root = process.cwd(),
  config,
  migrate = false,
  embedding: injected,
  forumHistory = false,
} = {}) {
  config ??= await loadKnowledgeConfig(dataDir);
  if (!config) return null;
  const embedding = injected || (await createEmbedding(config.embedding, root));
  const db = await openKnowledgeDatabase(config.database, dataDir, { migrate, forumHistory });
  let sourceValidator = null;
  const topK = config.topK ?? 4,
    minScore = config.minScore ?? 0.45;
  if (
    !Number.isInteger(topK) ||
    topK < 1 ||
    topK > 8 ||
    !Number.isFinite(minScore) ||
    minScore < 0 ||
    minScore > 1
  ) {
    await db.close();
    fail('knowledge_config', 'Invalid vector retrieval limits');
  }
  return {
    mode: config.database.provider,
    embeddingModel: embedding.model,
    embeddingIdentity: embedding.identity,
    forum: forumHistory ? createForumVector(db, embedding) : null,
    setSourceValidator(fn) {
      sourceValidator = fn;
    },
    async status(spaceId) {
      identifier(spaceId);
      const s = await db.query('SELECT * FROM hdbase_kb.spaces WHERE space_id=$1', [spaceId]);
      const c = await db.query(
        'SELECT count(*)::int AS chunks FROM hdbase_kb.chunks WHERE space_id=$1',
        [spaceId],
      );
      return {
        indexed: !!s.rows[0],
        chunks: c.rows[0].chunks,
        model: s.rows[0]?.model_name || null,
        currentModelMatches: !s.rows[0] || s.rows[0].model_key === embedding.identity,
      };
    },
    async import(spaceId, input, { replace = false } = {}) {
      identifier(spaceId);
      const prepared = prepareDocuments(input),
        contentHash = digest(prepared.chunks);
      const existing = await db.query('SELECT * FROM hdbase_kb.spaces WHERE space_id=$1', [
        spaceId,
      ]);
      if (
        existing.rows[0]?.content_hash === contentHash &&
        existing.rows[0]?.model_key === embedding.identity
      )
        return { ...prepared, chunks: prepared.chunks.length, reused: true };
      if (existing.rows.length && !replace)
        fail(
          'knowledge_exists',
          'Different index exists. Review input, then use --replace for this space only.',
        );
      const vectors = [];
      for (let i = 0; i < prepared.chunks.length; i += 32)
        vectors.push(
          ...(await embedding.embed(
            prepared.chunks.slice(i, i + 32).map((c) => c.title + '\n' + c.body),
          )),
        );
      if (vectors.length !== prepared.chunks.length)
        fail('invalid_vector', 'Embedding count mismatch');
      // Complete replacement is a single PostgreSQL transaction: withdrawn and
      // deleted documents disappear atomically. No other school's rows are touched.
      await db.transaction(async (tx) => {
        if (config.database.provider === 'postgres')
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            'hdbase-kb:' + spaceId,
          ]);
        const current = await tx.query(
          'SELECT content_hash FROM hdbase_kb.spaces WHERE space_id=$1',
          [spaceId],
        );
        if (current.rows.length && !replace)
          fail(
            'knowledge_exists',
            'Index appeared during import; existing school data preserved. Review then use --replace.',
          );
        await tx.query(
          'INSERT INTO hdbase_kb.spaces(space_id,model_key,model_name,dimensions,content_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(space_id) DO UPDATE SET model_key=$2,model_name=$3,dimensions=$4,content_hash=$5,imported_at=now()',
          [spaceId, embedding.identity, embedding.model, embedding.dimensions, contentHash],
        );
        await tx.query('DELETE FROM hdbase_kb.chunks WHERE space_id=$1', [spaceId]);
        for (let i = 0; i < prepared.chunks.length; i++) {
          const c = prepared.chunks[i],
            v = vectors[i];
          if (v.length !== embedding.dimensions || v.some((x) => !Number.isFinite(x)))
            fail('invalid_vector', 'Embedding dimensions mismatch');
          await tx.query(
            'INSERT INTO hdbase_kb.chunks(space_id,source_id,document_id,title,body,revision,source_label,scene_id,entity_id,embedding,model_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11)',
            [
              spaceId,
              c.id,
              c.documentId,
              c.title,
              c.body,
              c.revision,
              c.sourceLabel,
              c.sceneId,
              c.entityId,
              JSON.stringify(v),
              embedding.identity,
            ],
          );
        }
      });
      return {
        documents: prepared.documents,
        chunks: prepared.chunks.length,
        excluded: prepared.excluded,
        reused: false,
      };
    },
    async retrieve(pack, principal, query, { signal } = {}) {
      authorize(principal, pack.spaceId, 'a2a:call');
      const status = await this.status(pack.spaceId);
      if (!status.indexed || !status.chunks) return [];
      if (!status.currentModelMatches)
        fail('knowledge_reindex', 'Embedding changed; reindex this space before searching');
      const [vector] = await embedding.embed([text(query, 6000)], { query: true, signal });
      const rows = await db.query(
        'SELECT source_id AS id,document_id AS "documentId",title,body,revision,source_label AS "sourceLabel",scene_id AS "sceneId",entity_id AS "entityId",1-(embedding <=> $2::vector) AS score FROM hdbase_kb.chunks WHERE space_id=$1 AND model_key=$3 ORDER BY embedding <=> $2::vector LIMIT $4',
        [pack.spaceId, JSON.stringify(vector), embedding.identity, topK],
      );
      const found = rows.rows.filter((r) => r.score >= minScore);
      return sourceValidator ? sourceValidator(pack.spaceId, found) : found;
    },
    async hasSources(spaceId, ids) {
      if (!ids.length) return true;
      const rows = await db.query(
        'SELECT source_id AS id,document_id AS "documentId",revision,body FROM hdbase_kb.chunks WHERE space_id=$1 AND source_id=ANY($2::text[])',
        [spaceId, ids],
      );
      const visible = sourceValidator ? await sourceValidator(spaceId, rows.rows) : rows.rows;
      return new Set(visible.map((r) => r.id)).size === new Set(ids).size;
    },
    close: () => db.close(),
  };
}
