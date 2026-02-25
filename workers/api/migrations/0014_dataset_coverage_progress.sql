-- Dataset-level hourly Wayback coverage tracking.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dataset_coverage_progress (
  dataset_key TEXT PRIMARY KEY
    CHECK (dataset_key IN ('mortgage', 'savings', 'term_deposits')),
  first_coverage_date TEXT
    CHECK (
      first_coverage_date IS NULL
      OR first_coverage_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  cursor_date TEXT
    CHECK (
      cursor_date IS NULL
      OR cursor_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed_lower_bound')),
  empty_streak INTEGER NOT NULL DEFAULT 0 CHECK (empty_streak >= 0),
  last_tick_at TEXT,
  last_tick_status TEXT,
  last_tick_run_id TEXT,
  last_tick_message TEXT,
  last_result_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO dataset_coverage_progress (dataset_key, status)
VALUES
  ('mortgage', 'pending'),
  ('savings', 'pending'),
  ('term_deposits', 'pending');

CREATE INDEX IF NOT EXISTS idx_dataset_coverage_progress_status_updated
  ON dataset_coverage_progress(status, updated_at DESC);
