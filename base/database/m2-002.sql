-- Additive personal presentation. hd_m2_profiles remains the sole basic-profile authority.
CREATE TABLE hd_personal_preferences (
 school_id text NOT NULL,user_id uuid NOT NULL,version integer NOT NULL DEFAULT 0,
 organization_visibility jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_personal_works (
 work_id uuid PRIMARY KEY,school_id text NOT NULL,user_id uuid NOT NULL,
 version integer NOT NULL,title text NOT NULL,description text NOT NULL,link text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','published','withdrawn')),
 visibility text NOT NULL CHECK(visibility IN ('private','school')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE INDEX hd_personal_works_owner ON hd_personal_works(school_id,user_id,updated_at);
CREATE TABLE hd_personal_work_history (
 work_id uuid NOT NULL REFERENCES hd_personal_works,version integer NOT NULL,
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(work_id,version)
);
CREATE TABLE hd_personal_badges (
 badge_id uuid PRIMARY KEY,school_id text NOT NULL,user_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,label text NOT NULL,
 issuer_id uuid NOT NULL REFERENCES hd_users,reason text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','revoked')),
 visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','school')),
 issued_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE INDEX hd_personal_badges_owner ON hd_personal_badges(school_id,user_id,issued_at);
