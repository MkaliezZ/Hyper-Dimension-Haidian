-- Additive diagnostics only. Failed rows remain pending and retain their original score/version.
ALTER TABLE hd_outbox ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE hd_outbox ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS hd_outbox_pending_id ON hd_outbox(id) WHERE NOT delivered;
