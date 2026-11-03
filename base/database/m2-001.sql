CREATE TABLE hd_m2_avatars (
 school_id text NOT NULL,user_id uuid NOT NULL,version integer NOT NULL,recipe jsonb NOT NULL,
 model_hash text NOT NULL,catalog_hash text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m2_avatar_history (
 school_id text NOT NULL,user_id uuid NOT NULL,version integer NOT NULL,recipe jsonb NOT NULL,
 model_hash text NOT NULL,source text NOT NULL,legacy_version integer,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,user_id,version),FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m2_inventory (
 school_id text NOT NULL,user_id uuid NOT NULL,revision integer NOT NULL DEFAULT 0,
 starter_claimed boolean NOT NULL DEFAULT false,equipped_item text,
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m2_items (
 school_id text NOT NULL,user_id uuid NOT NULL,item_id text NOT NULL,quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 999),
 PRIMARY KEY(school_id,user_id,item_id),FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m2_inventory_events (
 event_id uuid PRIMARY KEY,school_id text NOT NULL,user_id uuid NOT NULL,actor_id uuid,
 action text NOT NULL,item_id text NOT NULL,delta integer NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m2_collections (
 collection_id uuid PRIMARY KEY,school_id text NOT NULL,user_id uuid NOT NULL,kind text NOT NULL,
 source_key text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,user_id,kind,source_key),FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
CREATE TABLE hd_m2_profiles (
 school_id text NOT NULL,user_id uuid NOT NULL,version integer NOT NULL DEFAULT 0,
 fields jsonb NOT NULL,visibility jsonb NOT NULL,PRIMARY KEY(school_id,user_id),
 FOREIGN KEY(school_id,user_id) REFERENCES hd_memberships
);
