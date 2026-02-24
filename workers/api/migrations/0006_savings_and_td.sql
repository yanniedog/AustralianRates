-- Add savings account and term deposit tables, views, and indexes.

-- ============================================================
-- Table: historical_savings_rates
-- ============================================================
CREATE TABLE IF NOT EXISTS historical_savings_rates (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('savings', 'transaction', 'at_call')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('base', 'bonus', 'introductory', 'bundle', 'total')),
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL DEFAULT 'all',
  min_balance REAL,
  max_balance REAL,
  conditions TEXT,
  monthly_fee REAL,
  source_url TEXT NOT NULL,
  data_quality_flag TEXT NOT NULL DEFAULT 'ok',
  confidence_score REAL NOT NULL DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  parsed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_id TEXT,
  run_source TEXT NOT NULL DEFAULT 'scheduled' CHECK (run_source IN ('scheduled', 'manual')),
  UNIQUE(bank_name, collection_date, product_id, rate_type, deposit_tier, run_source)
);

CREATE INDEX IF NOT EXISTS idx_savings_collection_date
  ON historical_savings_rates(collection_date);

CREATE INDEX IF NOT EXISTS idx_savings_bank_date
  ON historical_savings_rates(bank_name, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_savings_product
  ON historical_savings_rates(product_id, rate_type, deposit_tier);

CREATE INDEX IF NOT EXISTS idx_savings_run_source
  ON historical_savings_rates(run_source, collection_date DESC);

-- ============================================================
-- Table: historical_term_deposit_rates
-- ============================================================
CREATE TABLE IF NOT EXISTS historical_term_deposit_rates (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  term_months INTEGER NOT NULL,
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL DEFAULT 'all',
  min_deposit REAL,
  max_deposit REAL,
  interest_payment TEXT NOT NULL DEFAULT 'at_maturity' CHECK (interest_payment IN ('at_maturity', 'monthly', 'quarterly', 'annually')),
  source_url TEXT NOT NULL,
  data_quality_flag TEXT NOT NULL DEFAULT 'ok',
  confidence_score REAL NOT NULL DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  parsed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_id TEXT,
  run_source TEXT NOT NULL DEFAULT 'scheduled' CHECK (run_source IN ('scheduled', 'manual')),
  UNIQUE(bank_name, collection_date, product_id, term_months, deposit_tier, run_source)
);

CREATE INDEX IF NOT EXISTS idx_td_collection_date
  ON historical_term_deposit_rates(collection_date);

CREATE INDEX IF NOT EXISTS idx_td_bank_date
  ON historical_term_deposit_rates(bank_name, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_td_product
  ON historical_term_deposit_rates(product_id, term_months, deposit_tier);

CREATE INDEX IF NOT EXISTS idx_td_run_source
  ON historical_term_deposit_rates(run_source, collection_date DESC);

-- ============================================================
-- Views: Savings
-- ============================================================
CREATE VIEW IF NOT EXISTS vw_latest_savings_rates AS
WITH ranked AS (
  SELECT
    bank_name,
    collection_date,
    product_id,
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
    data_quality_flag,
    confidence_score,
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, account_type, rate_type, deposit_tier
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_savings_rates
  WHERE run_source != 'manual'
)
SELECT
  bank_name,
  collection_date,
  product_id,
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
  data_quality_flag,
  confidence_score,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

CREATE VIEW IF NOT EXISTS vw_savings_timeseries AS
SELECT
  collection_date,
  bank_name,
  product_id,
  product_name,
  account_type,
  rate_type,
  interest_rate,
  deposit_tier,
  min_balance,
  max_balance,
  conditions,
  monthly_fee,
  data_quality_flag,
  confidence_score,
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier AS product_key
FROM historical_savings_rates;

-- ============================================================
-- Views: Term Deposits
-- ============================================================
CREATE VIEW IF NOT EXISTS vw_latest_td_rates AS
WITH ranked AS (
  SELECT
    bank_name,
    collection_date,
    product_id,
    product_name,
    term_months,
    interest_rate,
    deposit_tier,
    min_deposit,
    max_deposit,
    interest_payment,
    source_url,
    data_quality_flag,
    confidence_score,
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, term_months, deposit_tier
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_term_deposit_rates
  WHERE run_source != 'manual'
)
SELECT
  bank_name,
  collection_date,
  product_id,
  product_name,
  term_months,
  interest_rate,
  deposit_tier,
  min_deposit,
  max_deposit,
  interest_payment,
  source_url,
  data_quality_flag,
  confidence_score,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

CREATE VIEW IF NOT EXISTS vw_td_timeseries AS
SELECT
  collection_date,
  bank_name,
  product_id,
  product_name,
  term_months,
  interest_rate,
  deposit_tier,
  min_deposit,
  max_deposit,
  interest_payment,
  data_quality_flag,
  confidence_score,
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key
FROM historical_term_deposit_rates;
