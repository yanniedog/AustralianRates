CREATE TABLE IF NOT EXISTS historical_provenance_recovery_runs (
  recovery_job_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'dry_run', 'failed')),
  lookback_days INTEGER NOT NULL DEFAULT 3650,
  dataset_filter TEXT CHECK (dataset_filter IN ('home_loans', 'savings', 'term_deposits')),
  run_id_filter TEXT,
  repair_summary_json TEXT NOT NULL DEFAULT '{}',
  sync_summary_json TEXT NOT NULL DEFAULT '{}',
  before_summary_json TEXT NOT NULL DEFAULT '{}',
  after_summary_json TEXT NOT NULL DEFAULT '{}',
  status_rows_upserted INTEGER NOT NULL DEFAULT 0,
  log_rows_written INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historical_provenance_recovery_runs_finished
  ON historical_provenance_recovery_runs(finished_at DESC);
