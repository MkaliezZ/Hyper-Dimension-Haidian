-- Reviewed annual planning is separate from live activities, contributions and private messages.
CREATE TABLE hd_annual_packages (
 school_id text NOT NULL REFERENCES hd_schools, scope_id text NOT NULL DEFAULT '',
 package_id text NOT NULL, version integer NOT NULL CHECK(version>0), document jsonb NOT NULL,
 fingerprint text NOT NULL, actor_id uuid NOT NULL REFERENCES hd_users, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,scope_id,package_id,version)
);
CREATE TABLE hd_annual_heads (
 school_id text NOT NULL, scope_id text NOT NULL DEFAULT '', package_id text NOT NULL,
 active_version integer NOT NULL, revision integer NOT NULL CHECK(revision>0),
 actor_id uuid NOT NULL REFERENCES hd_users, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,scope_id,package_id),
 FOREIGN KEY(school_id,scope_id,package_id,active_version) REFERENCES hd_annual_packages(school_id,scope_id,package_id,version)
);
CREATE TABLE hd_annual_tasks (
 school_id text NOT NULL, task_id uuid NOT NULL, scope_id text NOT NULL DEFAULT '',
 package_id text NOT NULL, package_version integer NOT NULL, academic_year integer NOT NULL,
 entry_id text NOT NULL, snapshot jsonb NOT NULL, period text NOT NULL,
 owner_id uuid NOT NULL REFERENCES hd_users, status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','done','cancelled')),
 due_at timestamptz, date_verified boolean NOT NULL DEFAULT false, official_url text,
 activity_id uuid, revision integer NOT NULL DEFAULT 1, history jsonb NOT NULL DEFAULT '[]',
 created_by uuid NOT NULL REFERENCES hd_users, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,task_id), UNIQUE(school_id,scope_id,package_id,academic_year,entry_id),
 FOREIGN KEY(school_id,scope_id,package_id,package_version) REFERENCES hd_annual_packages(school_id,scope_id,package_id,version)
);
CREATE TABLE hd_annual_personal (
 school_id text NOT NULL REFERENCES hd_schools, user_id uuid NOT NULL REFERENCES hd_users, scope_id text NOT NULL DEFAULT '',
 package_id text NOT NULL, academic_year integer NOT NULL, chain_id text NOT NULL,
 entry_id text NOT NULL, snapshot jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('active','done','not-applicable')),
 priority text CHECK(priority IN ('A','B','C')), due_at timestamptz,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,user_id,scope_id,package_id,academic_year,chain_id)
);
