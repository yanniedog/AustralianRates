CREATE TABLE IF NOT EXISTS raw_payload_store (
  payload_hash TEXT PRIMARY KEY,
  encoding TEXT NOT NULL CHECK (encoding IN ('gzip')),
  payload_blob BLOB NOT NULL,
  uncompressed_bytes INTEGER NOT NULL CHECK (uncompressed_bytes >= 0),
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

ALTER TABLE raw_payloads ADD COLUMN payload_hash TEXT;

UPDATE raw_payloads
SET payload_hash = content_hash
WHERE payload_hash IS NULL
  AND content_hash IS NOT NULL
  AND TRIM(content_hash) != '';

CREATE INDEX IF NOT EXISTS idx_raw_payloads_payload_hash
  ON raw_payloads(payload_hash);
