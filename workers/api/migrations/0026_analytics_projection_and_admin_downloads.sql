CREATE TABLE IF NOT EXISTS home_loan_rate_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('initial', 'state_change', 'rate_change', 'spec_change', 'removed', 'reinstated')),
  change_json TEXT NOT NULL DEFAULT '{}',
  state_hash TEXT NOT NULL,
  previous_state_hash TEXT,
  security_purpose TEXT NOT NULL,
  repayment_type TEXT NOT NULL,
  rate_structure TEXT NOT NULL,
  lvr_tier TEXT NOT NULL,
  feature_set TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  comparison_rate REAL,
  annual_fee REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_home_loan_rate_events_series_date
  ON home_loan_rate_events(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_loan_rate_events_type_date
  ON home_loan_rate_events(event_type, collection_date DESC, bank_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_home_loan_rate_events_dedup
  ON home_loan_rate_events(series_key, collection_date, state_hash, event_type, run_source);

CREATE TABLE IF NOT EXISTS home_loan_rate_intervals (
  interval_id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  effective_from_collection_date TEXT NOT NULL,
  effective_to_collection_date TEXT,
  opened_at TEXT NOT NULL,
  last_confirmed_collection_date TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  security_purpose TEXT NOT NULL,
  repayment_type TEXT NOT NULL,
  rate_structure TEXT NOT NULL,
  lvr_tier TEXT NOT NULL,
  feature_set TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  comparison_rate REAL,
  annual_fee REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  UNIQUE(series_key, effective_from_collection_date)
);

CREATE INDEX IF NOT EXISTS idx_home_loan_rate_intervals_series_window
  ON home_loan_rate_intervals(series_key, effective_from_collection_date DESC, effective_to_collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_home_loan_rate_intervals_bank_window
  ON home_loan_rate_intervals(bank_name, effective_from_collection_date DESC);

CREATE TABLE IF NOT EXISTS savings_rate_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('initial', 'state_change', 'rate_change', 'spec_change', 'removed', 'reinstated')),
  change_json TEXT NOT NULL DEFAULT '{}',
  state_hash TEXT NOT NULL,
  previous_state_hash TEXT,
  account_type TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  deposit_tier TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  min_balance REAL,
  max_balance REAL,
  conditions TEXT,
  monthly_fee REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_savings_rate_events_series_date
  ON savings_rate_events(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_savings_rate_events_type_date
  ON savings_rate_events(event_type, collection_date DESC, bank_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_savings_rate_events_dedup
  ON savings_rate_events(series_key, collection_date, state_hash, event_type, run_source);

CREATE TABLE IF NOT EXISTS savings_rate_intervals (
  interval_id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  effective_from_collection_date TEXT NOT NULL,
  effective_to_collection_date TEXT,
  opened_at TEXT NOT NULL,
  last_confirmed_collection_date TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  account_type TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  deposit_tier TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  min_balance REAL,
  max_balance REAL,
  conditions TEXT,
  monthly_fee REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  UNIQUE(series_key, effective_from_collection_date)
);

CREATE INDEX IF NOT EXISTS idx_savings_rate_intervals_series_window
  ON savings_rate_intervals(series_key, effective_from_collection_date DESC, effective_to_collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_savings_rate_intervals_bank_window
  ON savings_rate_intervals(bank_name, effective_from_collection_date DESC);

CREATE TABLE IF NOT EXISTS td_rate_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('initial', 'state_change', 'rate_change', 'spec_change', 'removed', 'reinstated')),
  change_json TEXT NOT NULL DEFAULT '{}',
  state_hash TEXT NOT NULL,
  previous_state_hash TEXT,
  term_months INTEGER NOT NULL,
  deposit_tier TEXT NOT NULL,
  interest_payment TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  min_deposit REAL,
  max_deposit REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_td_rate_events_series_date
  ON td_rate_events(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_td_rate_events_type_date
  ON td_rate_events(event_type, collection_date DESC, bank_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_td_rate_events_dedup
  ON td_rate_events(series_key, collection_date, state_hash, event_type, run_source);

CREATE TABLE IF NOT EXISTS td_rate_intervals (
  interval_id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  effective_from_collection_date TEXT NOT NULL,
  effective_to_collection_date TEXT,
  opened_at TEXT NOT NULL,
  last_confirmed_collection_date TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  deposit_tier TEXT NOT NULL,
  interest_payment TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  min_deposit REAL,
  max_deposit REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  UNIQUE(series_key, effective_from_collection_date)
);

CREATE INDEX IF NOT EXISTS idx_td_rate_intervals_series_window
  ON td_rate_intervals(series_key, effective_from_collection_date DESC, effective_to_collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_td_rate_intervals_bank_window
  ON td_rate_intervals(bank_name, effective_from_collection_date DESC);

CREATE TABLE IF NOT EXISTS analytics_projection_state (
  state_key TEXT PRIMARY KEY,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  last_series_key TEXT,
  last_collection_date TEXT,
  last_parsed_at TEXT,
  last_run_id TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_projection_state_dataset
  ON analytics_projection_state(dataset_kind, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS download_change_feed (
  cursor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream TEXT NOT NULL CHECK (stream IN ('canonical', 'optimized', 'operational')),
  dataset_kind TEXT CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  table_name TEXT NOT NULL,
  entity_key_json TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete', 'tombstone')),
  run_id TEXT,
  collection_date TEXT,
  emitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_download_change_feed_stream_cursor
  ON download_change_feed(stream, cursor_id DESC);
CREATE INDEX IF NOT EXISTS idx_download_change_feed_dataset_cursor
  ON download_change_feed(dataset_kind, cursor_id DESC);
CREATE INDEX IF NOT EXISTS idx_download_change_feed_run_id
  ON download_change_feed(run_id, cursor_id DESC);

CREATE TABLE IF NOT EXISTS admin_download_jobs (
  job_id TEXT PRIMARY KEY,
  stream TEXT NOT NULL CHECK (stream IN ('canonical', 'optimized', 'operational')),
  scope TEXT NOT NULL CHECK (scope IN ('all', 'home_loans', 'savings', 'term_deposits')),
  mode TEXT NOT NULL CHECK (mode IN ('snapshot', 'delta')),
  format TEXT NOT NULL CHECK (format IN ('jsonl_gzip')),
  since_cursor INTEGER,
  end_cursor INTEGER,
  include_payload_bodies INTEGER NOT NULL DEFAULT 0 CHECK (include_payload_bodies IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_download_jobs_stream_requested
  ON admin_download_jobs(stream, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_download_jobs_status_requested
  ON admin_download_jobs(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS admin_download_artifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('main', 'payload_bodies', 'manifest')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  row_count INTEGER,
  byte_size INTEGER,
  cursor_start INTEGER,
  cursor_end INTEGER,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES admin_download_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_download_artifacts_job
  ON admin_download_artifacts(job_id, created_at DESC);
