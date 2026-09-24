-- Single k/v table mirroring the previous KV layout.
-- Namespaces are encoded in the key (user:*, repo:*, installation:*, pr:*).
-- We add expires_at so PR state can be time-limited without a background job.
CREATE TABLE IF NOT EXISTS kv (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kv_expires_at ON kv (expires_at);
