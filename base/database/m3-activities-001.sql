-- Additive activities and volunteer participation authority; no source data replaced.
CREATE SEQUENCE hd_activity_queue_seq;
CREATE TABLE hd_activities (
 school_id text NOT NULL REFERENCES hd_schools, activity_id uuid NOT NULL,
 org_id text, creator_id uuid NOT NULL REFERENCES hd_users,
 kind text NOT NULL CHECK(kind IN ('event','volunteer')), title text NOT NULL,
 description text NOT NULL, conditions text NOT NULL, tasks jsonb NOT NULL DEFAULT '[]',
 scene_id text, entity_id text, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 registration_closes_at timestamptz NOT NULL, capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 100000),
 remind_before_minutes integer NOT NULL DEFAULT 60 CHECK(remind_before_minutes BETWEEN 0 AND 10080),
 verifier_ids uuid[] NOT NULL, status text NOT NULL CHECK(status IN ('draft','pending','published','rejected','cancelled')),
 revision integer NOT NULL DEFAULT 1, reviewed_by uuid REFERENCES hd_users, review_reason text,
 recap text, recap_revision integer NOT NULL DEFAULT 0, recap_by uuid REFERENCES hd_users,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,activity_id), FOREIGN KEY(school_id,org_id) REFERENCES hd_organizations,
 CHECK(ends_at>starts_at), CHECK(registration_closes_at<=ends_at)
);
CREATE TABLE hd_activity_registrations (
 school_id text NOT NULL, registration_id uuid NOT NULL, activity_id uuid NOT NULL,
 user_id uuid NOT NULL, task_id text,
 status text NOT NULL CHECK(status IN ('registered','waitlisted','withdrawn','cancelled','verified','revoked')),
 revision integer NOT NULL DEFAULT 1, queue_position bigint NOT NULL DEFAULT nextval('hd_activity_queue_seq'),
 latest_submission_id uuid, verification_event_id text, verified_minutes integer,
 verified_by uuid REFERENCES hd_users, verified_at timestamptz, revoke_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,registration_id), UNIQUE(school_id,activity_id,user_id),
 FOREIGN KEY(school_id,activity_id) REFERENCES hd_activities,
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_activity_submissions (
 school_id text NOT NULL, submission_id uuid NOT NULL, registration_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES hd_users, note text NOT NULL, attachments jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL CHECK(status IN ('pending','accepted','rejected','superseded')),
 reason text, reviewed_by uuid REFERENCES hd_users, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,submission_id),
 FOREIGN KEY(school_id,registration_id) REFERENCES hd_activity_registrations
);
CREATE TABLE hd_activity_events (
 event_id text PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 activity_id uuid NOT NULL, registration_id uuid, object_id uuid NOT NULL, source_revision integer NOT NULL,
 kind text NOT NULL, actor_id uuid REFERENCES hd_users, user_id uuid REFERENCES hd_users,
 envelope jsonb NOT NULL, contribution_status text NOT NULL DEFAULT 'not-applicable',
 occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,object_id,source_revision),
 FOREIGN KEY(school_id,activity_id) REFERENCES hd_activities
);
CREATE TABLE hd_activity_reminders (
 school_id text NOT NULL, reminder_id uuid NOT NULL, registration_id uuid NOT NULL,
 activity_id uuid NOT NULL, user_id uuid NOT NULL, due_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('scheduled','delivered','cancelled')),
 event_id text NOT NULL UNIQUE, delivered_at timestamptz,
 PRIMARY KEY(school_id,reminder_id), UNIQUE(school_id,registration_id,event_id),
 FOREIGN KEY(school_id,registration_id) REFERENCES hd_activity_registrations
);
CREATE INDEX hd_activity_directory ON hd_activities(school_id,status,starts_at);
CREATE INDEX hd_activity_queue ON hd_activity_registrations(school_id,activity_id,status,queue_position);
CREATE INDEX hd_activity_personal ON hd_activity_registrations(school_id,user_id);
CREATE INDEX hd_activity_due ON hd_activity_reminders(school_id,status,due_at);
