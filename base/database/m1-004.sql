ALTER TABLE hd_audit ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE hd_audit ADD COLUMN actor_kind text NOT NULL DEFAULT 'human';
ALTER TABLE hd_audit ADD CONSTRAINT hd_audit_actor_kind CHECK (
 (actor_kind='human' AND actor_id IS NOT NULL) OR
 (actor_kind IN ('system','operator') AND actor_id IS NULL)
);
