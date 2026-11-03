import { fail, text } from '../protocol/index.mjs';
export function createForumVector(db, embedding) {
  return {
    async apply(spaceId, source, sourceHash, { reset = false } = {}) {
      const chunks = [];
      for (const version of source.versions || []) {
        if (
          !Number.isSafeInteger(version.revision) ||
          version.revision < 1 ||
          typeof version.content !== 'string' ||
          version.content.length > 100000
        )
          fail('forum_index_source', 'Invalid native reviewed revision');
        for (let offset = 0, n = 0; offset < version.content.length; offset += 300, n++) {
          chunks.push({ ...version, chunk: n, body: version.content.slice(offset, offset + 350) });
          if (offset + 350 >= version.content.length) break;
        }
      }
      const vectors = [];
      for (let i = 0; i < chunks.length; i += 32)
        vectors.push(
          ...(await embedding.embed(chunks.slice(i, i + 32).map((c) => c.title + '\n' + c.body))),
        );
      if (vectors.length !== chunks.length) fail('invalid_vector', 'Embedding count mismatch');
      await db.transaction(async (c) => {
        if (db.provider === 'postgres')
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            'forum-index:' + spaceId + ':' + source.id,
          ]);
        if (reset || !source.published)
          await c.query('DELETE FROM hdbase_forum.revisions WHERE space_id=$1 AND source_id=$2', [
            spaceId,
            source.id,
          ]);
        if (!source.published) {
          await c.query('DELETE FROM hdbase_forum.heads WHERE space_id=$1 AND source_id=$2', [
            spaceId,
            source.id,
          ]);
          return;
        }
        await c.query(
          'INSERT INTO hdbase_forum.heads VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(space_id,source_id) DO UPDATE SET scope_id=$3,revision=$4,source_hash=$5,model_key=$6',
          [spaceId, source.id, source.scopeId, source.revision, sourceHash, embedding.identity],
        );
        for (let i = 0; i < chunks.length; i++) {
          const v = vectors[i],
            x = chunks[i];
          if (v.length !== embedding.dimensions || v.some((n) => !Number.isFinite(n)))
            fail('invalid_vector', 'Embedding dimensions mismatch');
          await c.query(
            'INSERT INTO hdbase_forum.revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10) ON CONFLICT(space_id,source_id,revision,chunk_no) DO UPDATE SET title=$5,body=$6,baseline=$7,recorded_at=$8,embedding=$9::vector,model_key=$10',
            [
              spaceId,
              source.id,
              x.revision,
              x.chunk,
              x.title,
              x.body,
              Boolean(x.baseline),
              x.recordedAt,
              JSON.stringify(v),
              embedding.identity,
            ],
          );
        }
      });
      return { chunks: chunks.length };
    },
    async search(spaceId, scopeId, query, { includeHistory = false, limit = 8 } = {}) {
      text(query, 2000);
      const [v] = await embedding.embed([query], { query: true });
      const result = await db.query(
        `SELECT r.source_id AS "sourceId",r.revision,r.chunk_no AS "chunkNo",r.title,r.body,r.baseline,r.recorded_at AS "recordedAt",h.revision AS "currentRevision",h.source_hash AS "sourceHash",1-(r.embedding <=> $3::vector) AS score
        FROM hdbase_forum.revisions r JOIN hdbase_forum.heads h USING(space_id,source_id)
        WHERE h.space_id=$1 AND h.scope_id=$2 AND r.model_key=$4 AND h.model_key=$4 AND ($5 OR r.revision=h.revision)
        ORDER BY r.embedding <=> $3::vector,r.source_id,r.revision DESC,r.chunk_no LIMIT $6`,
        [
          spaceId,
          scopeId,
          JSON.stringify(v),
          embedding.identity,
          includeHistory,
          Math.min(100, limit),
        ],
      );
      return result.rows;
    },
  };
}
