-- Reward campaigns/receipts own eligibility and allocation, never a parallel inventory.
CREATE TABLE hd_rewards (
 school_id text NOT NULL,reward_id uuid NOT NULL,org_id text,creator_id uuid NOT NULL REFERENCES hd_users,
 kind text NOT NULL CHECK(kind IN ('badge','appearance','activity','partner')),
 title text NOT NULL,description text NOT NULL,target jsonb NOT NULL,
 minimum_contribution integer NOT NULL DEFAULT 0 CHECK(minimum_contribution>=0),contribution_period text,
 stock integer NOT NULL CHECK(stock BETWEEN 1 AND 1000000),allocated integer NOT NULL DEFAULT 0 CHECK(allocated>=0 AND allocated<=stock),
 starts_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>starts_at),
 demonstration boolean NOT NULL DEFAULT true,
 status text NOT NULL CHECK(status IN ('draft','pending','published','rejected','withdrawn')),
 revision integer NOT NULL DEFAULT 1,reviewed_by uuid REFERENCES hd_users,review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,reward_id),FOREIGN KEY(school_id,org_id) REFERENCES hd_organizations
);
CREATE TABLE hd_reward_claims (
 school_id text NOT NULL,claim_id uuid NOT NULL,reward_id uuid NOT NULL,user_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('reserved','fulfilled','failed','revoked','expired')),
 revision integer NOT NULL DEFAULT 1,attempts integer NOT NULL DEFAULT 0,
 eligibility jsonb NOT NULL,terms jsonb NOT NULL,authority_receipt jsonb,last_error text,
 expires_at timestamptz NOT NULL,revoke_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,claim_id),UNIQUE(school_id,reward_id,user_id),
 FOREIGN KEY(school_id,reward_id) REFERENCES hd_rewards,FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_reward_events (
 event_id text PRIMARY KEY,school_id text NOT NULL,reward_id uuid NOT NULL,claim_id uuid,
 actor_id uuid,kind text NOT NULL,revision integer NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,reward_id) REFERENCES hd_rewards
);
-- Explicitly bound NEW draft activities only; existing activities remain open as before.
CREATE TABLE hd_reward_activity_gates (
 school_id text NOT NULL,activity_id uuid NOT NULL,item_id text NOT NULL,created_by uuid NOT NULL REFERENCES hd_users,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,activity_id),
 FOREIGN KEY(school_id,activity_id) REFERENCES hd_activities
);
ALTER TABLE hd_personal_badges ADD COLUMN reward_claim_id uuid;
ALTER TABLE hd_personal_badges ADD COLUMN expires_at timestamptz;
ALTER TABLE hd_personal_badges ADD CONSTRAINT hd_personal_reward_claim_fk FOREIGN KEY(school_id,reward_claim_id) REFERENCES hd_reward_claims(school_id,claim_id);
CREATE UNIQUE INDEX hd_personal_reward_badge ON hd_personal_badges(school_id,reward_claim_id) WHERE reward_claim_id IS NOT NULL;
CREATE INDEX hd_rewards_directory ON hd_rewards(school_id,status,starts_at);
CREATE INDEX hd_reward_claim_owner ON hd_reward_claims(school_id,user_id,created_at);
CREATE INDEX hd_reward_claim_expiry ON hd_reward_claims(expires_at) WHERE status IN ('fulfilled','failed');
