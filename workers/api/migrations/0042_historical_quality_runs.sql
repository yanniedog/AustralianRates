CREATE TABLE IF NOT EXISTS historical_quality_runs (
  audit_run_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'resume', 'script', 'scheduled')),
  target_db TEXT NOT NULL DEFAULT 'australianrates_api',
  criteria_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial')),
  mode TEXT NOT NULL DEFAULT 'whole_date_scope' CHECK (mode IN ('whole_date_scope', 'split_by_lender')),
  next_collection_date TEXT,
  next_scope TEXT CHECK (next_scope IN ('home_loans', 'savings', 'term_deposits')),
  lender_cursor TEXT,
  total_dates INTEGER NOT NULL DEFAULT 0,
  processed_batches INTEGER NOT NULL DEFAULT 0,
  completed_dates INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  filters_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  artifacts_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_historical_quality_runs_status_started
  ON historical_quality_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_historical_quality_runs_updated
  ON historical_quality_runs(updated_at DESC);
