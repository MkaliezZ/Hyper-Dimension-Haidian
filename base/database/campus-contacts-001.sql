-- Explicit, school/organization scoped human contact consent. Existing DMs are not consent.
CREATE TABLE hd_contact_preferences (
 school_id text NOT NULL REFERENCES hd_schools, user_id uuid NOT NULL REFERENCES hd_users,
 accepting_contacts boolean NOT NULL DEFAULT true, allow_direct_messages boolean NOT NULL DEFAULT true,
 revision integer NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,user_id)
);
CREATE TABLE hd_contact_permissions (
 contact_id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 org_key text NOT NULL DEFAULT '', user_low uuid NOT NULL REFERENCES hd_users,
 user_high uuid NOT NULL REFERENCES hd_users, requested_by uuid NOT NULL REFERENCES hd_users,
 status text NOT NULL CHECK(status IN ('pending','accepted','rejected','revoked')),
 revision integer NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(user_low<user_high), CHECK(requested_by IN (user_low,user_high)),
 UNIQUE(school_id,org_key,user_low,user_high)
);
CREATE TABLE hd_contact_events (
 event_id text PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 contact_id uuid REFERENCES hd_contact_permissions, actor_id uuid NOT NULL REFERENCES hd_users,
 kind text NOT NULL, envelope jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hd_contact_events_actor ON hd_contact_events(school_id,actor_id,created_at);
