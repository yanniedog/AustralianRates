CREATE TABLE IF NOT EXISTS ingest_replay_queue (
  replay_id TEXT PRIMARY KEY,
  replay_key TEXT NOT NULL UNIQUE,
  message_kind TEXT NOT NULL CHECK (
    message_kind IN (
      'daily_lender_fetch',
      'product_detail_fetch',
      'lender_finalize',
      'backfill_snapshot_fetch',
      'backfill_day_fetch',
      'daily_savings_lender_fetch',
      'historical_task_execute'
    )
  ),
  payload_json TEXT NOT NULL,
  run_id TEXT,
  lender_code TEXT,
  dataset_kind TEXT CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  product_id TEXT,
  collection_date TEXT,
  queue_exhausted_count INTEGER NOT NULL DEFAULT 0,
  replay_attempt_count INTEGER NOT NULL DEFAULT 0,
  max_replay_attempts INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'dispatching', 'succeeded', 'failed')),
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  last_attempt_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ingest_replay_queue_dispatch
  ON ingest_replay_queue(status, next_attempt_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_replay_queue_scope
  ON ingest_replay_queue(lender_code, dataset_kind, collection_date, status);
