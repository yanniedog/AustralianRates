PRAGMA foreign_keys = OFF;

ALTER TABLE product_catalog RENAME TO product_catalog_old;
CREATE TABLE product_catalog (
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  latest_product_name TEXT,
  latest_source_url TEXT,
  latest_product_url TEXT,
  latest_published_at TEXT,
  first_seen_collection_date TEXT NOT NULL,
  last_seen_collection_date TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  last_successful_run_id TEXT,
  PRIMARY KEY (dataset_kind, bank_name, product_id)
) WITHOUT ROWID;
INSERT INTO product_catalog
SELECT * FROM product_catalog_old;
DROP TABLE product_catalog_old;
CREATE INDEX IF NOT EXISTS idx_product_catalog_dataset_removed
  ON product_catalog(dataset_kind, is_removed, bank_name, last_seen_collection_date DESC);

ALTER TABLE series_catalog RENAME TO series_catalog_old;
CREATE TABLE series_catalog (
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  series_key TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  security_purpose TEXT,
  repayment_type TEXT,
  lvr_tier TEXT,
  rate_structure TEXT,
  account_type TEXT,
  rate_type TEXT,
  deposit_tier TEXT,
  term_months INTEGER,
  interest_payment TEXT,
  raw_dimensions_json TEXT NOT NULL,
  latest_source_url TEXT,
  latest_product_url TEXT,
  latest_published_at TEXT,
  first_seen_collection_date TEXT NOT NULL,
  last_seen_collection_date TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  last_successful_run_id TEXT
) WITHOUT ROWID;
INSERT INTO series_catalog
SELECT * FROM series_catalog_old;
DROP TABLE series_catalog_old;
CREATE INDEX IF NOT EXISTS idx_series_catalog_dataset_removed
  ON series_catalog(dataset_kind, is_removed, bank_name, last_seen_collection_date DESC);

ALTER TABLE series_presence_status RENAME TO series_presence_status_old;
CREATE TABLE series_presence_status (
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  series_key TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  last_seen_collection_date TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_run_id TEXT
) WITHOUT ROWID;
INSERT INTO series_presence_status
SELECT * FROM series_presence_status_old;
DROP TABLE series_presence_status_old;
CREATE INDEX IF NOT EXISTS idx_series_presence_dataset_removed
  ON series_presence_status(dataset_kind, is_removed, bank_name, last_seen_collection_date DESC);

ALTER TABLE run_seen_products RENAME TO run_seen_products_old;
CREATE TABLE run_seen_products (
  run_id TEXT NOT NULL,
  lender_code TEXT NOT NULL,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, lender_code, dataset_kind, bank_name, product_id)
) WITHOUT ROWID;
INSERT INTO run_seen_products
SELECT * FROM run_seen_products_old;
DROP TABLE run_seen_products_old;
CREATE INDEX IF NOT EXISTS idx_run_seen_products_lookup
  ON run_seen_products(run_id, lender_code, dataset_kind, collection_date);

ALTER TABLE run_seen_series RENAME TO run_seen_series_old;
CREATE TABLE run_seen_series (
  run_id TEXT NOT NULL,
  lender_code TEXT NOT NULL,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  series_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, lender_code, dataset_kind, series_key)
) WITHOUT ROWID;
INSERT INTO run_seen_series
SELECT * FROM run_seen_series_old;
DROP TABLE run_seen_series_old;
CREATE INDEX IF NOT EXISTS idx_run_seen_series_lookup
  ON run_seen_series(run_id, lender_code, dataset_kind, collection_date);

ALTER TABLE raw_objects RENAME TO raw_objects_old;
CREATE TABLE raw_objects (
  content_hash TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  first_source_url TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
INSERT INTO raw_objects
SELECT * FROM raw_objects_old;
DROP TABLE raw_objects_old;

ALTER TABLE lender_dataset_runs RENAME TO lender_dataset_runs_old;
CREATE TABLE lender_dataset_runs (
  run_id TEXT NOT NULL,
  lender_code TEXT NOT NULL,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  expected_detail_count INTEGER NOT NULL DEFAULT 0,
  completed_detail_count INTEGER NOT NULL DEFAULT 0,
  failed_detail_count INTEGER NOT NULL DEFAULT 0,
  finalized_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, lender_code, dataset_kind)
) WITHOUT ROWID;
INSERT INTO lender_dataset_runs
SELECT * FROM lender_dataset_runs_old;
DROP TABLE lender_dataset_runs_old;
CREATE INDEX IF NOT EXISTS idx_lender_dataset_runs_lookup
  ON lender_dataset_runs(collection_date DESC, dataset_kind, lender_code, finalized_at);

ALTER TABLE export_jobs RENAME TO export_jobs_old;
CREATE TABLE export_jobs (
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
) WITHOUT ROWID;
INSERT INTO export_jobs
SELECT * FROM export_jobs_old;
DROP TABLE export_jobs_old;
CREATE INDEX IF NOT EXISTS idx_export_jobs_dataset_requested
  ON export_jobs(dataset_kind, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status_requested
  ON export_jobs(status, requested_at DESC);

PRAGMA foreign_keys = ON;
