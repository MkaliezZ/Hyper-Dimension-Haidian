CREATE TABLE hd_attachments (
 school_id text NOT NULL REFERENCES hd_schools, attachment_id uuid NOT NULL,
 owner_id uuid NOT NULL REFERENCES hd_users,scope_id text NOT NULL DEFAULT '',
 purpose text NOT NULL CHECK(purpose IN ('community','activity-evidence','organization-internal')),
 target_id text NOT NULL,name text NOT NULL,mime_type text NOT NULL,
 sha256 text NOT NULL,bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 524288),body bytea,
 status text NOT NULL CHECK(status IN ('active','withdrawn','deleted','expired')),
 revision integer NOT NULL DEFAULT 1,legal_hold boolean NOT NULL DEFAULT false,
 hold_reason text,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,attachment_id)
);
CREATE INDEX hd_attachment_owner ON hd_attachments(school_id,owner_id);
