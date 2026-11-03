-- Additive M0 schema. Never reads or migrates the v0.2.1 .local store.
CREATE TABLE IF NOT EXISTS hd_users (
  user_id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  display_name text NOT NULL, UNIQUE(issuer, subject)
);
CREATE TABLE IF NOT EXISTS hd_schools (school_id text PRIMARY KEY, space_id text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS hd_memberships (
  school_id text NOT NULL REFERENCES hd_schools, user_id uuid NOT NULL REFERENCES hd_users,
  role text NOT NULL CHECK(role IN ('student','moderator','owner')), active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1, PRIMARY KEY(school_id,user_id)
);
CREATE TABLE IF NOT EXISTS hd_identities (
  school_id text NOT NULL, user_id uuid NOT NULL, system text NOT NULL,
  external_id text NOT NULL, PRIMARY KEY(school_id,user_id,system), UNIQUE(school_id,system,external_id),
  FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE IF NOT EXISTS hd_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES hd_users,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS hd_auth_flows (
  state_hash text PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS hd_avatars (
  school_id text NOT NULL, user_id uuid NOT NULL, version integer NOT NULL,
  recipe jsonb NOT NULL, model_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(school_id,user_id), FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE IF NOT EXISTS hd_receipts (
  school_id text NOT NULL, user_id uuid NOT NULL, request_id text NOT NULL,
  input_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(school_id,user_id,request_id)
);
CREATE TABLE IF NOT EXISTS hd_forum_heads (
  school_id text NOT NULL, source_id text NOT NULL, revision integer NOT NULL,
  status text NOT NULL, user_id uuid NOT NULL REFERENCES hd_users, PRIMARY KEY(school_id,source_id)
);
CREATE TABLE IF NOT EXISTS hd_events (
  event_id text PRIMARY KEY, school_id text NOT NULL, source_id text NOT NULL,
  source_revision integer NOT NULL, envelope jsonb NOT NULL, input_hash text NOT NULL,
  UNIQUE(school_id,source_id,source_revision)
);
CREATE TABLE IF NOT EXISTS hd_contributions (
  id bigserial PRIMARY KEY, event_id text NOT NULL UNIQUE REFERENCES hd_events,
  school_id text NOT NULL, user_id uuid NOT NULL REFERENCES hd_users,
  period text NOT NULL, delta integer NOT NULL, rule_version text NOT NULL,
  reverses bigint REFERENCES hd_contributions, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hd_scores (
  school_id text NOT NULL, user_id uuid NOT NULL, period text NOT NULL,
  score integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(school_id,user_id,period)
);
CREATE TABLE IF NOT EXISTS hd_outbox (
  id bigserial PRIMARY KEY, school_id text NOT NULL, user_id uuid NOT NULL,
  period text NOT NULL, score integer NOT NULL, version integer NOT NULL,
  delivered boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0,
  UNIQUE(school_id,user_id,period,version)
);
CREATE TABLE IF NOT EXISTS hd_tickets (
  token_hash text PRIMARY KEY, school_id text NOT NULL, user_id uuid NOT NULL,
  purpose text NOT NULL, expires_at timestamptz NOT NULL
);
