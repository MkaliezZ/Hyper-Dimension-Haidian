-- Run in a dedicated Base database. Existing application tables are untouched.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS hdbase_kb;
CREATE TABLE IF NOT EXISTS hdbase_kb.spaces (
  space_id text PRIMARY KEY,
  model_key text NOT NULL,
  model_name text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 2 AND 4096),
  content_hash text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hdbase_kb.chunks (
  space_id text NOT NULL REFERENCES hdbase_kb.spaces(space_id),
  source_id text NOT NULL,
  document_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  source_label text NOT NULL,
  scene_id text,
  entity_id text,
  embedding vector NOT NULL,
  model_key text NOT NULL,
  PRIMARY KEY (space_id, source_id)
);
CREATE INDEX IF NOT EXISTS chunks_space_model ON hdbase_kb.chunks(space_id, model_key);
-- Exact cosine search is the conservative default. For large corpora, add a
-- dimension-specific HNSW index after profiling; see docs/KNOWLEDGE.md.
