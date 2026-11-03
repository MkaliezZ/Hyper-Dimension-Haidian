-- Additive Base-4 business authority. External service data is never written here.
CREATE TABLE hd_m5_partners (
 school_id text NOT NULL REFERENCES hd_schools, partner_id uuid NOT NULL,
 applicant_id uuid NOT NULL REFERENCES hd_users, name text NOT NULL, category text NOT NULL,
 description text NOT NULL, org_id text,
 status text NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')),
 revision integer NOT NULL DEFAULT 1, valid_until timestamptz NOT NULL,
 reviewed_by uuid REFERENCES hd_users, review_reason text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,partner_id), FOREIGN KEY(school_id,org_id) REFERENCES hd_organizations
);
CREATE TABLE hd_m5_staff (
 school_id text NOT NULL, partner_id uuid NOT NULL, user_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('maintainer','redeemer')), active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, PRIMARY KEY(school_id,partner_id,user_id),
 FOREIGN KEY(school_id,partner_id) REFERENCES hd_m5_partners,
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m5_services (
 school_id text NOT NULL, service_id uuid NOT NULL, partner_id uuid NOT NULL,
 title text NOT NULL, description text NOT NULL, conditions text NOT NULL,
 hours text NOT NULL, official_url text, scene_id text, entity_id text,
 status text NOT NULL CHECK(status IN ('pending','published','rejected','withdrawn')),
 revision integer NOT NULL DEFAULT 1, valid_until timestamptz NOT NULL,
 reviewed_by uuid REFERENCES hd_users, review_reason text,
 PRIMARY KEY(school_id,service_id), FOREIGN KEY(school_id,partner_id) REFERENCES hd_m5_partners
);
CREATE TABLE hd_m5_offers (
 school_id text NOT NULL, offer_id uuid NOT NULL, partner_id uuid NOT NULL,
 title text NOT NULL, terms text NOT NULL, stock integer NOT NULL CHECK(stock BETWEEN 1 AND 1000000),
 issued integer NOT NULL DEFAULT 0 CHECK(issued>=0), min_contribution integer NOT NULL DEFAULT 0 CHECK(min_contribution>=0),
 contribution_period text, org_id text, withdrawal_policy text NOT NULL CHECK(withdrawal_policy IN ('honor','revoke')),
 valid_until timestamptz NOT NULL, status text NOT NULL CHECK(status IN ('pending','published','rejected','withdrawn')),
 revision integer NOT NULL DEFAULT 1, reviewed_by uuid REFERENCES hd_users, review_reason text,
 PRIMARY KEY(school_id,offer_id), FOREIGN KEY(school_id,partner_id) REFERENCES hd_m5_partners,
 FOREIGN KEY(school_id,org_id) REFERENCES hd_organizations, CHECK(issued<=stock)
);
CREATE TABLE hd_m5_entitlements (
 school_id text NOT NULL, entitlement_id uuid NOT NULL, partner_id uuid NOT NULL, offer_id uuid NOT NULL,
 user_id uuid NOT NULL, token text NOT NULL UNIQUE, status text NOT NULL CHECK(status IN ('issued','redeemed','revoked')),
 revision integer NOT NULL DEFAULT 1, valid_until timestamptz NOT NULL,
 terms jsonb NOT NULL, redeemed_by uuid REFERENCES hd_users, redeemed_at timestamptz, revoked_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,entitlement_id),
 UNIQUE(school_id,offer_id,user_id), FOREIGN KEY(school_id,offer_id) REFERENCES hd_m5_offers,
 FOREIGN KEY(school_id,partner_id) REFERENCES hd_m5_partners,
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m5_tasks (
 school_id text NOT NULL, task_id uuid NOT NULL, partner_id uuid NOT NULL, service_id uuid NOT NULL,
 user_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('consultation','appointment')),
 status text NOT NULL CHECK(status IN ('proposed','queued','pending_confirmation','confirmed','cancel_requested','cancel_pending','cancelled','failed','adapter_unavailable')),
 revision integer NOT NULL DEFAULT 1, source_revision integer NOT NULL, source_snapshot jsonb NOT NULL,
 request jsonb NOT NULL, consent jsonb, external_receipt jsonb, cancel_receipt jsonb, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,task_id), FOREIGN KEY(school_id,partner_id) REFERENCES hd_m5_partners,
 FOREIGN KEY(school_id,service_id) REFERENCES hd_m5_services, FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m5_adapter_operations (
 school_id text NOT NULL, operation_id text NOT NULL, task_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('create','cancel')), fingerprint text NOT NULL,
 state text NOT NULL CHECK(state IN ('prepared','uncertain','completed')), receipt jsonb, last_error text,
 attempts integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,operation_id), FOREIGN KEY(school_id,task_id) REFERENCES hd_m5_tasks
);
-- An explicitly local fictitious adapter used by the isolated acceptance fixture only.
CREATE TABLE hd_m5_fixture_bookings (
 school_id text NOT NULL, task_id uuid NOT NULL, partner_id uuid NOT NULL,
 fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('confirmed','cancelled')),
 receipt_id uuid NOT NULL, cancel_receipt_id uuid,
 PRIMARY KEY(school_id,task_id)
);
CREATE TABLE hd_m5_events (
 event_id text PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools, partner_id uuid NOT NULL,
 object_id uuid NOT NULL, revision integer NOT NULL, kind text NOT NULL, envelope jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,object_id,revision)
);
CREATE TABLE hd_m5_metrics (
 school_id text NOT NULL, partner_id uuid NOT NULL, kind text NOT NULL,
 actor_id uuid NOT NULL, object_id uuid NOT NULL, day date NOT NULL DEFAULT current_date,
 PRIMARY KEY(school_id,partner_id,kind,actor_id,object_id,day),
 FOREIGN KEY(school_id,partner_id) REFERENCES hd_m5_partners
);
CREATE INDEX hd_m5_task_pending ON hd_m5_tasks(school_id,status);
CREATE INDEX hd_m5_entitlement_owner ON hd_m5_entitlements(school_id,user_id);
