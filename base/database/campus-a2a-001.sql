CREATE TABLE hd_agent_delegations (
  delegation_id uuid PRIMARY KEY,
  school_id text NOT NULL REFERENCES hd_schools(school_id),
  user_id uuid NOT NULL REFERENCES hd_users(user_id),
  token_hash text UNIQUE NOT NULL,
  label text NOT NULL,
  service_ids uuid[] NOT NULL,
  skills text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hd_agent_delegations_owner ON hd_agent_delegations(school_id,user_id);
