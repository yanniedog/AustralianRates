-- Add retrieval provenance and auto-backfill progress state.

PRAGMA foreign_keys = OFF;

ALTER TABLE historical_loan_rates
  ADD COLUMN retrieval_type TEXT NOT NULL DEFAULT 'present_scrape_same_date'
  CHECK (retrieval_type IN ('historical_scrape', 'present_scrape_same_date'));

ALTER TABLE historical_savings_rates
  ADD COLUMN retrieval_type TEXT NOT NULL DEFAULT 'present_scrape_same_date'
  CHECK (retrieval_type IN ('historical_scrape', 'present_scrape_same_date'));

ALTER TABLE historical_term_deposit_rates
  ADD COLUMN retrieval_type TEXT NOT NULL DEFAULT 'present_scrape_same_date'
  CHECK (retrieval_type IN ('historical_scrape', 'present_scrape_same_date'));

UPDATE historical_loan_rates
SET retrieval_type = CASE
  WHEN data_quality_flag LIKE 'parsed_from_wayback%' OR source_url LIKE 'https://web.archive.org/web/%' THEN 'historical_scrape'
  ELSE 'present_scrape_same_date'
END;

UPDATE historical_savings_rates
SET retrieval_type = CASE
  WHEN data_quality_flag LIKE 'parsed_from_wayback%' OR source_url LIKE 'https://web.archive.org/web/%' THEN 'historical_scrape'
  ELSE 'present_scrape_same_date'
END;

UPDATE historical_term_deposit_rates
SET retrieval_type = CASE
  WHEN data_quality_flag LIKE 'parsed_from_wayback%' OR source_url LIKE 'https://web.archive.org/web/%' THEN 'historical_scrape'
  ELSE 'present_scrape_same_date'
END;

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_retrieval_date
  ON historical_loan_rates(retrieval_type, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_savings_rates_retrieval_date
  ON historical_savings_rates(retrieval_type, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_td_rates_retrieval_date
  ON historical_term_deposit_rates(retrieval_type, collection_date DESC);

CREATE TABLE IF NOT EXISTS auto_backfill_progress (
  lender_code TEXT PRIMARY KEY,
  next_collection_date TEXT NOT NULL CHECK (next_collection_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  empty_streak INTEGER NOT NULL DEFAULT 0 CHECK (empty_streak >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed_full_history')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_run_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_auto_backfill_progress_status
  ON auto_backfill_progress(status, updated_at DESC);

DROP VIEW IF EXISTS vw_latest_rates;
DROP VIEW IF EXISTS vw_rate_timeseries;
DROP VIEW IF EXISTS vw_latest_savings_rates;
DROP VIEW IF EXISTS vw_savings_timeseries;
DROP VIEW IF EXISTS vw_latest_td_rates;
DROP VIEW IF EXISTS vw_td_timeseries;

CREATE VIEW vw_latest_rates AS
WITH ranked AS (
  SELECT
    bank_name,
    collection_date,
    product_id,
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
    data_quality_flag,
    confidence_score,
    retrieval_type,
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, security_purpose, repayment_type, lvr_tier, rate_structure
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_loan_rates
)
SELECT
  bank_name,
  collection_date,
  product_id,
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
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

CREATE VIEW vw_rate_timeseries AS
SELECT
  collection_date,
  bank_name,
  product_id,
  product_name,
  security_purpose,
  repayment_type,
  lvr_tier,
  rate_structure,
  feature_set,
  interest_rate,
  comparison_rate,
  annual_fee,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key
FROM historical_loan_rates;

CREATE VIEW vw_latest_savings_rates AS
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
    retrieval_type,
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, account_type, rate_type, deposit_tier
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_savings_rates
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
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

CREATE VIEW vw_savings_timeseries AS
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
  retrieval_type,
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier AS product_key
FROM historical_savings_rates;

CREATE VIEW vw_latest_td_rates AS
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
    retrieval_type,
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, term_months, deposit_tier, interest_payment
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_term_deposit_rates
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
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

CREATE VIEW vw_td_timeseries AS
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
  retrieval_type,
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key
FROM historical_term_deposit_rates;

PRAGMA foreign_keys = ON;
