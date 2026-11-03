CREATE TABLE hd_environment_places (
 school_id text NOT NULL REFERENCES hd_schools, place_id uuid NOT NULL,
 scene_id text NOT NULL, entity_id text NOT NULL, org_id text,
 manager_user_id uuid REFERENCES hd_users, public_role_label text NOT NULL DEFAULT '',
 role_label_published boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES hd_users,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,place_id), UNIQUE(school_id,scene_id,entity_id)
);
CREATE TABLE hd_environment_announcements (
 school_id text NOT NULL, announcement_id uuid NOT NULL, place_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES hd_users, title text NOT NULL, body text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','pending','published','rejected','withdrawn')),
 revision integer NOT NULL DEFAULT 1, reviewed_by uuid REFERENCES hd_users,
 review_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,announcement_id), FOREIGN KEY(school_id,place_id) REFERENCES hd_environment_places
);
CREATE TABLE hd_environment_feedback (
 school_id text NOT NULL, feedback_id uuid NOT NULL, place_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES hd_users, kind text NOT NULL CHECK(kind IN ('problem','suggestion')),
 body text NOT NULL, status text NOT NULL CHECK(status IN ('submitted','claimed','in_progress','resolved','rejected')),
 assigned_to uuid REFERENCES hd_users, resolution text, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,feedback_id), FOREIGN KEY(school_id,place_id) REFERENCES hd_environment_places
);
CREATE TABLE hd_environment_events (
 event_id text PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 object_id uuid NOT NULL, source_revision integer NOT NULL, actor_id uuid NOT NULL REFERENCES hd_users,
 kind text NOT NULL, envelope jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,object_id,source_revision)
);
CREATE INDEX hd_environment_feedback_owner ON hd_environment_feedback(school_id,user_id,created_at);
CREATE INDEX hd_environment_feedback_place ON hd_environment_feedback(school_id,place_id,status);
