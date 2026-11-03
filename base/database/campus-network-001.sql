-- Opt-in public cards are separate from private personal fields. School-local, no global directory.
CREATE TABLE hd_network_profiles (
 school_id text NOT NULL REFERENCES hd_schools, user_id uuid NOT NULL REFERENCES hd_users,
 revision integer NOT NULL CHECK(revision>0), status text NOT NULL CHECK(status IN ('pending','published','rejected','withdrawn','suspended')),
 document jsonb NOT NULL, anchor jsonb, moderation_reason text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,user_id)
);
CREATE INDEX hd_network_directory ON hd_network_profiles(school_id,status,updated_at);
CREATE TABLE hd_mentor_slots (
 slot_id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 mentor_id uuid NOT NULL REFERENCES hd_users, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 20), topic text NOT NULL, anchor jsonb,
 status text NOT NULL CHECK(status IN ('open','closed')), revision integer NOT NULL CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at>starts_at)
);
CREATE INDEX hd_mentor_schedule ON hd_mentor_slots(school_id,mentor_id,starts_at,ends_at);
CREATE TABLE hd_mentor_bookings (
 booking_id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 slot_id uuid NOT NULL REFERENCES hd_mentor_slots, student_id uuid NOT NULL REFERENCES hd_users,
 status text NOT NULL CHECK(status IN ('requested','confirmed','declined','canceled','completed')),
 question text NOT NULL, revision integer NOT NULL CHECK(revision>0), reason text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hd_mentor_booking_active ON hd_mentor_bookings(slot_id,student_id) WHERE status IN ('requested','confirmed');
CREATE TABLE hd_career_opportunities (
 opportunity_id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 source_id text NOT NULL, org_id text, author_id uuid NOT NULL REFERENCES hd_users,
 revision integer NOT NULL CHECK(revision>0), status text NOT NULL CHECK(status IN ('pending','active','withdrawn')),
 approved_source_revision integer,
 kind text NOT NULL CHECK(kind IN ('internship','job','scholarship','project','experience','consultation')),
 organization text NOT NULL, audience text NOT NULL, deadline timestamptz NOT NULL,
 application_url text NOT NULL DEFAULT '', anchor jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,source_id)
);
CREATE INDEX hd_career_board ON hd_career_opportunities(school_id,status,deadline);
CREATE TABLE hd_career_bookmarks (
 school_id text NOT NULL REFERENCES hd_schools, user_id uuid NOT NULL REFERENCES hd_users,
 opportunity_id uuid NOT NULL REFERENCES hd_career_opportunities, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,user_id,opportunity_id)
);
