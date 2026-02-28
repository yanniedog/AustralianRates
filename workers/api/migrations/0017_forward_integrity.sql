PRAGMA foreign_keys = OFF;

ALTER TABLE historical_loan_rates ADD COLUMN product_code TEXT;
ALTER TABLE historical_loan_rates ADD COLUMN series_key TEXT;
ALTER TABLE historical_loan_rates ADD COLUMN fetch_event_id INTEGER;

ALTER TABLE historical_savings_rates ADD COLUMN product_code TEXT;
ALTER TABLE historical_savings_rates ADD COLUMN series_key TEXT;
ALTER TABLE historical_savings_rates ADD COLUMN fetch_event_id INTEGER;

ALTER TABLE historical_term_deposit_rates ADD COLUMN product_code TEXT;
ALTER TABLE historical_term_deposit_rates ADD COLUMN series_key TEXT;
ALTER TABLE historical_term_deposit_rates ADD COLUMN fetch_event_id INTEGER;

UPDATE historical_loan_rates
SET
  product_code = COALESCE(NULLIF(product_code, ''), product_id),
  series_key = COALESCE(
    NULLIF(series_key, ''),
    bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure
  )
WHERE product_code IS NULL OR series_key IS NULL OR product_code = '' OR series_key = '';

UPDATE historical_savings_rates
SET
  product_code = COALESCE(NULLIF(product_code, ''), product_id),
  series_key = COALESCE(
    NULLIF(series_key, ''),
    bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier
  )
WHERE product_code IS NULL OR series_key IS NULL OR product_code = '' OR series_key = '';

UPDATE historical_term_deposit_rates
SET
  product_code = COALESCE(NULLIF(product_code, ''), product_id),
  series_key = COALESCE(
    NULLIF(series_key, ''),
    bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier || '|' || interest_payment
  )
WHERE product_code IS NULL OR series_key IS NULL OR product_code = '' OR series_key = '';

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_series_key
  ON historical_loan_rates(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_savings_rates_series_key
  ON historical_savings_rates(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_td_rates_series_key
  ON historical_term_deposit_rates(series_key, collection_date DESC, parsed_at DESC);

CREATE TABLE IF NOT EXISTS product_catalog (
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
);

CREATE INDEX IF NOT EXISTS idx_product_catalog_dataset_removed
  ON product_catalog(dataset_kind, is_removed, bank_name, last_seen_collection_date DESC);

CREATE TABLE IF NOT EXISTS series_catalog (
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
);

CREATE INDEX IF NOT EXISTS idx_series_catalog_dataset_removed
  ON series_catalog(dataset_kind, is_removed, bank_name, last_seen_collection_date DESC);

CREATE TABLE IF NOT EXISTS series_presence_status (
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
);

CREATE INDEX IF NOT EXISTS idx_series_presence_dataset_removed
  ON series_presence_status(dataset_kind, is_removed, bank_name, last_seen_collection_date DESC);

CREATE TABLE IF NOT EXISTS run_seen_products (
  run_id TEXT NOT NULL,
  lender_code TEXT NOT NULL,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, lender_code, dataset_kind, bank_name, product_id)
);

CREATE INDEX IF NOT EXISTS idx_run_seen_products_lookup
  ON run_seen_products(run_id, lender_code, dataset_kind, collection_date);

CREATE TABLE IF NOT EXISTS run_seen_series (
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
);

CREATE INDEX IF NOT EXISTS idx_run_seen_series_lookup
  ON run_seen_series(run_id, lender_code, dataset_kind, collection_date);

CREATE TABLE IF NOT EXISTS raw_objects (
  content_hash TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  first_source_url TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fetch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  lender_code TEXT,
  dataset_kind TEXT CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  job_kind TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  collection_date TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  http_status INTEGER,
  content_hash TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  response_headers_json TEXT,
  duration_ms INTEGER,
  product_id TEXT,
  raw_object_created INTEGER NOT NULL DEFAULT 0 CHECK (raw_object_created IN (0, 1)),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_fetch_events_run_lookup
  ON fetch_events(run_id, lender_code, dataset_kind, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_events_source_lookup
  ON fetch_events(source_type, source_url, fetched_at DESC);

CREATE TABLE IF NOT EXISTS ingest_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetch_event_id INTEGER,
  run_id TEXT,
  lender_code TEXT,
  dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  product_id TEXT,
  series_key TEXT,
  collection_date TEXT,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  candidate_json TEXT NOT NULL,
  normalized_candidate_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingest_anomalies_lookup
  ON ingest_anomalies(dataset_kind, lender_code, collection_date DESC, reason);

CREATE TABLE IF NOT EXISTS lender_dataset_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_lender_dataset_runs_lookup
  ON lender_dataset_runs(collection_date DESC, dataset_kind, lender_code, finalized_at);

CREATE TABLE IF NOT EXISTS latest_home_loan_series (
  series_key TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
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
  cdr_product_detail_json TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT
);

CREATE TABLE IF NOT EXISTS latest_savings_series (
  series_key TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL,
  min_balance REAL,
  max_balance REAL,
  conditions TEXT,
  monthly_fee REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_json TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT
);

CREATE TABLE IF NOT EXISTS latest_td_series (
  series_key TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL,
  min_deposit REAL,
  max_deposit REAL,
  interest_payment TEXT NOT NULL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_json TEXT,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  run_id TEXT,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT
);

INSERT OR IGNORE INTO product_catalog (
  dataset_kind, bank_name, product_id, product_code, latest_product_name, latest_source_url, latest_product_url, latest_published_at,
  first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
)
SELECT
  'home_loans',
  bank_name,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  source_url,
  product_url,
  published_at,
  MIN(collection_date),
  MAX(collection_date),
  MIN(parsed_at),
  MAX(parsed_at),
  0,
  NULL,
  MAX(run_id)
FROM historical_loan_rates
GROUP BY bank_name, product_id;

INSERT OR IGNORE INTO product_catalog (
  dataset_kind, bank_name, product_id, product_code, latest_product_name, latest_source_url, latest_product_url, latest_published_at,
  first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
)
SELECT
  'savings',
  bank_name,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  source_url,
  product_url,
  published_at,
  MIN(collection_date),
  MAX(collection_date),
  MIN(parsed_at),
  MAX(parsed_at),
  0,
  NULL,
  MAX(run_id)
FROM historical_savings_rates
GROUP BY bank_name, product_id;

INSERT OR IGNORE INTO product_catalog (
  dataset_kind, bank_name, product_id, product_code, latest_product_name, latest_source_url, latest_product_url, latest_published_at,
  first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
)
SELECT
  'term_deposits',
  bank_name,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  source_url,
  product_url,
  published_at,
  MIN(collection_date),
  MAX(collection_date),
  MIN(parsed_at),
  MAX(parsed_at),
  0,
  NULL,
  MAX(run_id)
FROM historical_term_deposit_rates
GROUP BY bank_name, product_id;

INSERT OR IGNORE INTO series_catalog (
  dataset_kind, series_key, bank_name, product_id, product_code, product_name,
  security_purpose, repayment_type, lvr_tier, rate_structure,
  account_type, rate_type, deposit_tier, term_months, interest_payment,
  raw_dimensions_json, latest_source_url, latest_product_url, latest_published_at,
  first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
)
SELECT
  'home_loans',
  series_key,
  bank_name,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  security_purpose,
  repayment_type,
  lvr_tier,
  rate_structure,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  json_object(
    'dataset', 'home_loans',
    'bank_name', bank_name,
    'product_id', product_id,
    'security_purpose', security_purpose,
    'repayment_type', repayment_type,
    'lvr_tier', lvr_tier,
    'rate_structure', rate_structure
  ),
  source_url,
  product_url,
  published_at,
  MIN(collection_date),
  MAX(collection_date),
  MIN(parsed_at),
  MAX(parsed_at),
  0,
  NULL,
  MAX(run_id)
FROM historical_loan_rates
GROUP BY series_key;

INSERT OR IGNORE INTO series_catalog (
  dataset_kind, series_key, bank_name, product_id, product_code, product_name,
  security_purpose, repayment_type, lvr_tier, rate_structure,
  account_type, rate_type, deposit_tier, term_months, interest_payment,
  raw_dimensions_json, latest_source_url, latest_product_url, latest_published_at,
  first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
)
SELECT
  'savings',
  series_key,
  bank_name,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  NULL,
  NULL,
  NULL,
  NULL,
  account_type,
  rate_type,
  deposit_tier,
  NULL,
  NULL,
  json_object(
    'dataset', 'savings',
    'bank_name', bank_name,
    'product_id', product_id,
    'account_type', account_type,
    'rate_type', rate_type,
    'deposit_tier', deposit_tier
  ),
  source_url,
  product_url,
  published_at,
  MIN(collection_date),
  MAX(collection_date),
  MIN(parsed_at),
  MAX(parsed_at),
  0,
  NULL,
  MAX(run_id)
FROM historical_savings_rates
GROUP BY series_key;

INSERT OR IGNORE INTO series_catalog (
  dataset_kind, series_key, bank_name, product_id, product_code, product_name,
  security_purpose, repayment_type, lvr_tier, rate_structure,
  account_type, rate_type, deposit_tier, term_months, interest_payment,
  raw_dimensions_json, latest_source_url, latest_product_url, latest_published_at,
  first_seen_collection_date, last_seen_collection_date, first_seen_at, last_seen_at, is_removed, removed_at, last_successful_run_id
)
SELECT
  'term_deposits',
  series_key,
  bank_name,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  deposit_tier,
  term_months,
  interest_payment,
  json_object(
    'dataset', 'term_deposits',
    'bank_name', bank_name,
    'product_id', product_id,
    'term_months', term_months,
    'deposit_tier', deposit_tier,
    'interest_payment', interest_payment
  ),
  source_url,
  product_url,
  published_at,
  MIN(collection_date),
  MAX(collection_date),
  MIN(parsed_at),
  MAX(parsed_at),
  0,
  NULL,
  MAX(run_id)
FROM historical_term_deposit_rates
GROUP BY series_key;

INSERT OR IGNORE INTO series_presence_status (
  dataset_kind, series_key, bank_name, product_id, product_code, is_removed, removed_at, last_seen_collection_date, last_seen_at, last_seen_run_id
)
SELECT
  dataset_kind,
  series_key,
  bank_name,
  product_id,
  product_code,
  is_removed,
  removed_at,
  last_seen_collection_date,
  last_seen_at,
  last_seen_run_id
FROM (
  SELECT
    'home_loans' AS dataset_kind,
    series_key,
    bank_name,
    product_id,
    COALESCE(product_code, product_id) AS product_code,
    0 AS is_removed,
    NULL AS removed_at,
    MAX(collection_date) AS last_seen_collection_date,
    MAX(parsed_at) AS last_seen_at,
    MAX(run_id) AS last_seen_run_id
  FROM historical_loan_rates
  GROUP BY series_key
  UNION ALL
  SELECT
    'savings',
    series_key,
    bank_name,
    product_id,
    COALESCE(product_code, product_id),
    0,
    NULL,
    MAX(collection_date),
    MAX(parsed_at),
    MAX(run_id)
  FROM historical_savings_rates
  GROUP BY series_key
  UNION ALL
  SELECT
    'term_deposits',
    series_key,
    bank_name,
    product_id,
    COALESCE(product_code, product_id),
    0,
    NULL,
    MAX(collection_date),
    MAX(parsed_at),
    MAX(run_id)
  FROM historical_term_deposit_rates
  GROUP BY series_key
);

DELETE FROM latest_home_loan_series;
INSERT INTO latest_home_loan_series (
  series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at, cdr_product_detail_json,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source, is_removed, removed_at
)
SELECT
  series_key,
  bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure,
  bank_name,
  collection_date,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  security_purpose,
  repayment_type,
  rate_structure,
  lvr_tier,
  feature_set,
  interest_rate,
  comparison_rate,
  annual_fee,
  source_url,
  product_url,
  published_at,
  cdr_product_detail_json,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  0,
  NULL
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS row_num
  FROM historical_loan_rates
)
WHERE row_num = 1;

DELETE FROM latest_savings_series;
INSERT INTO latest_savings_series (
  series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
  account_type, rate_type, interest_rate, deposit_tier, min_balance, max_balance, conditions, monthly_fee,
  source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, run_id, run_source, is_removed, removed_at
)
SELECT
  series_key,
  bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier,
  bank_name,
  collection_date,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  account_type,
  rate_type,
  interest_rate,
  deposit_tier,
  min_balance,
  max_balance,
  conditions,
  monthly_fee,
  source_url,
  product_url,
  published_at,
  cdr_product_detail_json,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  0,
  NULL
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS row_num
  FROM historical_savings_rates
)
WHERE row_num = 1;

DELETE FROM latest_td_series;
INSERT INTO latest_td_series (
  series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
  term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
  source_url, product_url, published_at, cdr_product_detail_json, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, run_id, run_source, is_removed, removed_at
)
SELECT
  series_key,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier,
  bank_name,
  collection_date,
  product_id,
  COALESCE(product_code, product_id),
  product_name,
  term_months,
  interest_rate,
  deposit_tier,
  min_deposit,
  max_deposit,
  interest_payment,
  source_url,
  product_url,
  published_at,
  cdr_product_detail_json,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  0,
  NULL
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS row_num
  FROM historical_term_deposit_rates
)
WHERE row_num = 1;

DROP TRIGGER IF EXISTS check_loan_rates_insert;
DROP TRIGGER IF EXISTS check_loan_rates_update;
DROP TRIGGER IF EXISTS check_savings_rates_insert;
DROP TRIGGER IF EXISTS check_savings_rates_update;
DROP TRIGGER IF EXISTS check_td_rates_insert;
DROP TRIGGER IF EXISTS check_td_rates_update;

PRAGMA foreign_keys = ON;
