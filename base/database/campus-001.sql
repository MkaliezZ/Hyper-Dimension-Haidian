-- Additive common information and subscription model. Source bodies stay in their owning service.
CREATE TABLE hd_subscriptions (
 school_id text NOT NULL, user_id uuid NOT NULL, scope_id text NOT NULL DEFAULT '',
 topic text NOT NULL CHECK(topic IN ('announcements','community','activities','partners')),
 active boolean NOT NULL, revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,user_id,scope_id,topic), FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_notification_preferences (
 school_id text NOT NULL, user_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, PRIMARY KEY(school_id,user_id),
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_information_events (
 school_id text NOT NULL REFERENCES hd_schools, event_id text NOT NULL,
 scope_id text NOT NULL DEFAULT '', topic text NOT NULL,
 source_id text NOT NULL, source_revision integer NOT NULL CHECK(source_revision>0),
 envelope jsonb NOT NULL, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,event_id), UNIQUE(school_id,topic,source_id,source_revision)
);
CREATE TABLE hd_information_heads (
 school_id text NOT NULL, topic text NOT NULL, source_id text NOT NULL, scope_id text NOT NULL DEFAULT '',
 revision integer NOT NULL, status text NOT NULL CHECK(status IN ('published','withdrawn','expired')),
 title text NOT NULL, expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,topic,source_id), FOREIGN KEY(school_id) REFERENCES hd_schools
);
ALTER TABLE hd_notifications ADD COLUMN information_event text;
ALTER TABLE hd_notifications ADD COLUMN scope_id text;
CREATE INDEX hd_notifications_information ON hd_notifications(school_id,information_event) WHERE information_event IS NOT NULL;
