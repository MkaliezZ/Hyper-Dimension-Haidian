-- Scheduling identity survives pg-boss retention and protects exact retries.
CREATE TABLE hd_scheduled_jobs (
 job_id uuid PRIMARY KEY,school_id text NOT NULL REFERENCES hd_schools,
 kind text NOT NULL,source_id text NOT NULL,input_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(school_id,kind,source_id)
);
