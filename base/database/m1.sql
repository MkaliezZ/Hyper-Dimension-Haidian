-- Versioned additive M1 migration. Applied in one transaction under a migration lock.
ALTER TABLE hd_users ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE hd_users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE hd_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE hd_sessions ADD COLUMN IF NOT EXISTS access_token text;
ALTER TABLE hd_memberships DROP CONSTRAINT IF EXISTS hd_memberships_role_check;
ALTER TABLE hd_memberships ADD CONSTRAINT hd_memberships_role_check CHECK(role IN ('student','moderator','owner','partner'));
CREATE TABLE hd_organizations (
 school_id text NOT NULL REFERENCES hd_schools, org_id text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('student','partner')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(school_id,org_id)
);
CREATE TABLE hd_org_members (
 school_id text NOT NULL, org_id text NOT NULL, user_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('member','moderator','owner','partner')), active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, PRIMARY KEY(school_id,org_id,user_id),
 FOREIGN KEY(school_id,org_id) REFERENCES hd_organizations,
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_invitations (
 token_hash text PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools, org_id text,
 email text NOT NULL, role text NOT NULL, created_by uuid NOT NULL REFERENCES hd_users,
 expires_at timestamptz NOT NULL, accepted_by uuid REFERENCES hd_users, accepted_at timestamptz,
 FOREIGN KEY(school_id,org_id) REFERENCES hd_organizations
);
CREATE TABLE hd_audit (
 sequence bigserial PRIMARY KEY, school_id text NOT NULL, actor_id uuid NOT NULL REFERENCES hd_users,
 action text NOT NULL, object_id text NOT NULL, detail jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hd_reconciliations (
 run_id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools, result jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hd_notifications (
 id bigserial PRIMARY KEY, school_id text NOT NULL, user_id uuid NOT NULL, event_id text NOT NULL,
 payload jsonb NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,user_id,event_id), FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_runtime_state (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), state jsonb NOT NULL);
CREATE TABLE hd_guest_claims (
 token_hash text PRIMARY KEY, guest_id text NOT NULL, expires_at timestamptz NOT NULL,
 used_by uuid REFERENCES hd_users
);
CREATE TABLE hd_guest_bindings (guest_id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES hd_users, bound_at timestamptz NOT NULL DEFAULT now());
