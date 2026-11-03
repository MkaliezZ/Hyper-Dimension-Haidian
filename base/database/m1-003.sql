CREATE TABLE hd_conversations (
 conversation_id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES hd_schools,
 org_id text, kind text NOT NULL CHECK(kind IN ('dm','room')), participants uuid[] NOT NULL,
 scope_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,scope_key), CHECK((kind='dm' AND cardinality(participants)=2) OR (kind='room' AND cardinality(participants)=0))
);
-- Body authority is Nakama. PostgreSQL contains routing, receipts and governance metadata only.
CREATE TABLE hd_chat_messages (
 message_id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES hd_conversations,
 school_id text NOT NULL REFERENCES hd_schools, sender_id uuid NOT NULL REFERENCES hd_users,
 revision integer NOT NULL DEFAULT 0, native_version text, status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, legal_hold boolean NOT NULL DEFAULT false
);
CREATE INDEX hd_chat_messages_conversation ON hd_chat_messages(conversation_id,created_at,message_id);
CREATE TABLE hd_chat_operations (
 operation_id uuid PRIMARY KEY, school_id text NOT NULL, user_id uuid NOT NULL,
 request_id text NOT NULL, message_id uuid NOT NULL REFERENCES hd_chat_messages,
 action text NOT NULL, input_hash text NOT NULL, expected_revision integer NOT NULL,
 state text NOT NULL DEFAULT 'pending', result jsonb, UNIQUE(school_id,user_id,request_id)
);
CREATE UNIQUE INDEX hd_chat_one_pending ON hd_chat_operations(message_id) WHERE state='pending';
CREATE TABLE hd_chat_events (
 sequence bigserial PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES hd_conversations,
 message_id uuid NOT NULL REFERENCES hd_chat_messages, revision integer NOT NULL, status text NOT NULL,
 UNIQUE(message_id,revision)
);
CREATE INDEX hd_chat_events_cursor ON hd_chat_events(conversation_id,sequence);
CREATE TABLE hd_chat_reads (
 conversation_id uuid NOT NULL REFERENCES hd_conversations,user_id uuid NOT NULL REFERENCES hd_users,
 last_sequence bigint NOT NULL DEFAULT 0, PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE hd_chat_blocks (
 school_id text NOT NULL REFERENCES hd_schools,user_id uuid NOT NULL REFERENCES hd_users,
 blocked_id uuid NOT NULL REFERENCES hd_users,PRIMARY KEY(school_id,user_id,blocked_id),CHECK(user_id<>blocked_id)
);
CREATE TABLE hd_chat_reports (
 report_id uuid PRIMARY KEY,school_id text NOT NULL REFERENCES hd_schools,
 message_id uuid NOT NULL REFERENCES hd_chat_messages,reporter_id uuid NOT NULL REFERENCES hd_users,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,resolution text,
 UNIQUE(message_id,reporter_id)
);
