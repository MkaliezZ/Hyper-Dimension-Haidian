-- Community pages are metadata only. NodeBB retains all forum bodies and workflow records.
CREATE TABLE hd_community_pages (
 school_id text NOT NULL REFERENCES hd_schools,
 scope_id text NOT NULL DEFAULT '',
 version integer NOT NULL CHECK(version>0),
 summary text NOT NULL CHECK(length(summary)<=2000),
 anchor jsonb,
 updated_by uuid NOT NULL REFERENCES hd_users,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,scope_id)
);
