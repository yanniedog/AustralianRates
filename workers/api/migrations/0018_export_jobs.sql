CREATE TABLE IF NOT EXISTS export_jobs (
  job_id TEXT PRIMARY KEY,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  export_scope TEXT NOT NULL CHECK (export_scope IN ('rates', 'timeseries')),
  format TEXT NOT NULL CHECK (format IN ('csv', 'json')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  filter_json TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  file_name TEXT,
  content_type TEXT,
  row_count INTEGER,
  r2_key TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_dataset_requested
  ON export_jobs(dataset_kind, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status_requested
  ON export_jobs(status, requested_at DESC);
