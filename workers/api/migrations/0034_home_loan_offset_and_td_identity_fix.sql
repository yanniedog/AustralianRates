PRAGMA foreign_keys = OFF;

ALTER TABLE historical_loan_rates
  ADD COLUMN has_offset_account INTEGER
  CHECK (has_offset_account IN (0, 1) OR has_offset_account IS NULL);

ALTER TABLE latest_home_loan_series
  ADD COLUMN has_offset_account INTEGER
  CHECK (has_offset_account IN (0, 1) OR has_offset_account IS NULL);

ALTER TABLE home_loan_rate_events
  ADD COLUMN has_offset_account INTEGER
  CHECK (has_offset_account IN (0, 1) OR has_offset_account IS NULL);

ALTER TABLE home_loan_rate_intervals
  ADD COLUMN has_offset_account INTEGER
  CHECK (has_offset_account IN (0, 1) OR has_offset_account IS NULL);

DROP VIEW IF EXISTS vw_latest_rates;
CREATE VIEW vw_latest_rates AS
WITH ranked AS (
  SELECT
    *,
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
  has_offset_account,
  interest_rate,
  comparison_rate,
  annual_fee,
  source_url,
  product_url,
  published_at,
  cdr_product_detail_hash,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

DROP VIEW IF EXISTS vw_rate_timeseries;
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
  has_offset_account,
  interest_rate,
  comparison_rate,
  annual_fee,
  source_url,
  product_url,
  published_at,
  cdr_product_detail_hash,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key
FROM historical_loan_rates;

DROP VIEW IF EXISTS vw_latest_td_rates;
CREATE VIEW vw_latest_td_rates AS
WITH ranked AS (
  SELECT
    *,
    bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier || '|' || interest_payment AS product_key,
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
  product_url,
  published_at,
  cdr_product_detail_hash,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

DROP VIEW IF EXISTS vw_td_timeseries;
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
  source_url,
  product_url,
  published_at,
  cdr_product_detail_hash,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier || '|' || interest_payment AS product_key
FROM historical_term_deposit_rates;

UPDATE latest_td_series
SET product_key = bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment;

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_offset_account
  ON historical_loan_rates(has_offset_account, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_latest_home_loan_series_offset_account
  ON latest_home_loan_series(has_offset_account, collection_date DESC);

PRAGMA foreign_keys = ON;
