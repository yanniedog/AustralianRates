CREATE TABLE IF NOT EXISTS home_loan_report_deltas (
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  previous_collection_date TEXT,
  interest_rate REAL NOT NULL,
  previous_interest_rate REAL,
  delta_bps INTEGER NOT NULL,
  delta_sign INTEGER NOT NULL CHECK (delta_sign IN (-1, 0, 1)),
  security_purpose TEXT NOT NULL,
  repayment_type TEXT NOT NULL,
  rate_structure TEXT NOT NULL,
  lvr_tier TEXT NOT NULL,
  feature_set TEXT NOT NULL,
  has_offset_account INTEGER,
  comparison_rate REAL,
  annual_fee REAL,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  PRIMARY KEY (series_key, collection_date)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_home_loan_report_deltas_collection_date
  ON home_loan_report_deltas(collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_home_loan_report_deltas_filters
  ON home_loan_report_deltas(
    collection_date DESC,
    bank_name,
    security_purpose,
    repayment_type,
    rate_structure,
    lvr_tier,
    feature_set
  );

CREATE INDEX IF NOT EXISTS idx_home_loan_report_deltas_removed
  ON home_loan_report_deltas(is_removed, collection_date DESC, bank_name);

CREATE TABLE IF NOT EXISTS savings_report_deltas (
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  previous_collection_date TEXT,
  interest_rate REAL NOT NULL,
  previous_interest_rate REAL,
  delta_bps INTEGER NOT NULL,
  delta_sign INTEGER NOT NULL CHECK (delta_sign IN (-1, 0, 1)),
  account_type TEXT NOT NULL,
  rate_type TEXT NOT NULL,
  deposit_tier TEXT NOT NULL,
  min_balance REAL,
  max_balance REAL,
  monthly_fee REAL,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  PRIMARY KEY (series_key, collection_date)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_savings_report_deltas_collection_date
  ON savings_report_deltas(collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_savings_report_deltas_filters
  ON savings_report_deltas(
    collection_date DESC,
    bank_name,
    account_type,
    rate_type,
    deposit_tier
  );

CREATE INDEX IF NOT EXISTS idx_savings_report_deltas_removed
  ON savings_report_deltas(is_removed, collection_date DESC, bank_name);

CREATE TABLE IF NOT EXISTS td_report_deltas (
  series_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  previous_collection_date TEXT,
  interest_rate REAL NOT NULL,
  previous_interest_rate REAL,
  delta_bps INTEGER NOT NULL,
  delta_sign INTEGER NOT NULL CHECK (delta_sign IN (-1, 0, 1)),
  term_months INTEGER NOT NULL,
  deposit_tier TEXT NOT NULL,
  min_deposit REAL,
  max_deposit REAL,
  interest_payment TEXT NOT NULL,
  data_quality_flag TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  retrieval_type TEXT NOT NULL,
  run_source TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  PRIMARY KEY (series_key, collection_date)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_td_report_deltas_collection_date
  ON td_report_deltas(collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_td_report_deltas_filters
  ON td_report_deltas(
    collection_date DESC,
    bank_name,
    term_months,
    deposit_tier,
    interest_payment
  );

CREATE INDEX IF NOT EXISTS idx_td_report_deltas_removed
  ON td_report_deltas(is_removed, collection_date DESC, bank_name);

CREATE TABLE IF NOT EXISTS report_plot_request_cache (
  section TEXT NOT NULL,
  mode TEXT NOT NULL,
  request_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  built_at TEXT NOT NULL,
  PRIMARY KEY (section, mode, request_scope)
);
