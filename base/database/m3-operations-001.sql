-- Versioned operating material and schedules only; activities, rules and rewards keep their authorities.
CREATE TABLE hd_operation_packages (
 school_id text NOT NULL REFERENCES hd_schools, scope_id text NOT NULL DEFAULT '',
 package_id text NOT NULL, version integer NOT NULL CHECK(version>0), document jsonb NOT NULL,
 fingerprint text NOT NULL, imported_by uuid NOT NULL REFERENCES hd_users, reason text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,scope_id,package_id,version)
);
CREATE TABLE hd_operation_heads (
 school_id text NOT NULL, scope_id text NOT NULL DEFAULT '', package_id text NOT NULL,
 active_version integer NOT NULL, revision integer NOT NULL CHECK(revision>0),
 activated_by uuid NOT NULL REFERENCES hd_users, reason text NOT NULL, activated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,scope_id,package_id),
 FOREIGN KEY(school_id,scope_id,package_id,active_version) REFERENCES hd_operation_packages(school_id,scope_id,package_id,version)
);
CREATE TABLE hd_operation_runs (
 school_id text NOT NULL, run_id uuid NOT NULL, scope_id text NOT NULL DEFAULT '',
 package_id text NOT NULL, package_version integer NOT NULL, package_fingerprint text NOT NULL,
 revision integer NOT NULL DEFAULT 1, responsible_id uuid NOT NULL REFERENCES hd_users,
 created_by uuid NOT NULL REFERENCES hd_users, title text NOT NULL,
 plan jsonb NOT NULL, activities jsonb NOT NULL, handoffs jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,run_id),
 FOREIGN KEY(school_id,scope_id,package_id,package_version) REFERENCES hd_operation_packages(school_id,scope_id,package_id,version)
);
CREATE INDEX hd_operations_scope ON hd_operation_runs(school_id,scope_id,created_at);
