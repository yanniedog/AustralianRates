CREATE TABLE IF NOT EXISTS historical_provenance_status (
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  series_key TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  run_id TEXT,
  provenance_state TEXT NOT NULL CHECK (provenance_state IN ('verified_exact', 'verified_reconstructed', 'legacy_unverifiable', 'quarantined')),
  recovery_method TEXT,
  reason_code TEXT NOT NULL,
  verified_fetch_event_id INTEGER,
  verified_content_hash TEXT,
  verified_source_url TEXT,
  evidence_json TEXT,
  first_classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dataset_kind, series_key, collection_date)
);

CREATE INDEX IF NOT EXISTS idx_historical_provenance_status_state
  ON historical_provenance_status(provenance_state, dataset_kind, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_historical_provenance_status_run
  ON historical_provenance_status(run_id, dataset_kind, collection_date DESC);

CREATE TABLE IF NOT EXISTS historical_provenance_recovery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recovery_job_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  series_key TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  run_id TEXT,
  previous_state TEXT,
  new_state TEXT NOT NULL CHECK (new_state IN ('verified_exact', 'verified_reconstructed', 'legacy_unverifiable', 'quarantined')),
  recovery_method TEXT,
  reason_code TEXT NOT NULL,
  fetch_event_id INTEGER,
  content_hash TEXT,
  source_url TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historical_provenance_recovery_job
  ON historical_provenance_recovery_log(recovery_job_id, dataset_kind, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_historical_provenance_recovery_state
  ON historical_provenance_recovery_log(new_state, dataset_kind, created_at DESC);
