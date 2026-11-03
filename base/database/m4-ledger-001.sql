-- One authoritative contribution ledger; additive metadata only for existing records.
ALTER TABLE hd_contributions ADD COLUMN scope_id text NOT NULL DEFAULT '';
ALTER TABLE hd_contributions ADD COLUMN kind text NOT NULL DEFAULT 'legacy';
ALTER TABLE hd_contributions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE INDEX hd_contributions_scope ON hd_contributions(school_id,scope_id,period,user_id);
CREATE UNIQUE INDEX hd_campus_unique_reversal ON hd_contributions(reverses)
 WHERE reverses IS NOT NULL AND kind<>'legacy';
CREATE TABLE hd_campus_rules (
 school_id text NOT NULL REFERENCES hd_schools, rule_version text NOT NULL,
 document jsonb NOT NULL, fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('draft','approved')),
 revision integer NOT NULL DEFAULT 1, imported_by uuid NOT NULL REFERENCES hd_users,
 approved_by uuid REFERENCES hd_users, approval_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
 PRIMARY KEY(school_id,rule_version)
);
CREATE TABLE hd_campus_periods (
 school_id text NOT NULL REFERENCES hd_schools, period text NOT NULL,
 scope_id text NOT NULL DEFAULT '', semester text NOT NULL, label text NOT NULL,
 rule_version text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','active','frozen')),
 revision integer NOT NULL DEFAULT 1, activated_at timestamptz, frozen_at timestamptz,
 snapshot_generation integer NOT NULL DEFAULT 0, created_by uuid NOT NULL REFERENCES hd_users,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,period), FOREIGN KEY(school_id,rule_version) REFERENCES hd_campus_rules,
 CHECK(ends_at>starts_at)
);
CREATE TABLE hd_campus_rank_snapshots (
 school_id text NOT NULL, period text NOT NULL, generation integer NOT NULL,
 user_id uuid NOT NULL REFERENCES hd_users, score integer NOT NULL, position integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,period,generation,user_id), FOREIGN KEY(school_id,period) REFERENCES hd_campus_periods
);
