CREATE TABLE hd_index_sources (
 school_id text NOT NULL REFERENCES hd_schools,kind text NOT NULL,source_id text NOT NULL,
 desired_hash text NOT NULL,indexed_hash text,indexed_revision integer NOT NULL DEFAULT 0,
 model_key text,job_id uuid,complete boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,kind,source_id)
);
CREATE TABLE hd_knowledge_snapshots (
 school_id text NOT NULL REFERENCES hd_schools,version integer NOT NULL,
 documents jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES hd_users,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,version)
);
