CREATE SCHEMA IF NOT EXISTS hdbase_forum;
CREATE TABLE IF NOT EXISTS hdbase_forum.heads (
 space_id text NOT NULL,source_id text NOT NULL,scope_id text NOT NULL,
 revision integer NOT NULL,source_hash text NOT NULL,model_key text NOT NULL,
 PRIMARY KEY(space_id,source_id)
);
CREATE TABLE IF NOT EXISTS hdbase_forum.revisions (
 space_id text NOT NULL,source_id text NOT NULL,revision integer NOT NULL,chunk_no integer NOT NULL,
 title text NOT NULL,body text NOT NULL,baseline boolean NOT NULL,recorded_at timestamptz NOT NULL,
 embedding vector NOT NULL,model_key text NOT NULL,
 PRIMARY KEY(space_id,source_id,revision,chunk_no)
);
CREATE INDEX IF NOT EXISTS forum_scope ON hdbase_forum.heads(space_id,scope_id);
