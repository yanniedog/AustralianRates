-- Add product URL and source published timestamp across all rate tables.
-- Also refresh latest/timeseries views so the new fields are available in API queries.

PRAGMA foreign_keys = OFF;

ALTER TABLE historical_loan_rates
  ADD COLUMN product_url TEXT;

ALTER TABLE historical_loan_rates
  ADD COLUMN published_at TEXT;

ALTER TABLE historical_savings_rates
  ADD COLUMN product_url TEXT;

ALTER TABLE historical_savings_rates
  ADD COLUMN published_at TEXT;

ALTER TABLE historical_term_deposit_rates
  ADD COLUMN product_url TEXT;

ALTER TABLE historical_term_deposit_rates
  ADD COLUMN published_at TEXT;

UPDATE historical_loan_rates
SET product_url = source_url
WHERE product_url IS NULL OR TRIM(product_url) = '';

UPDATE historical_savings_rates
SET product_url = source_url
WHERE product_url IS NULL OR TRIM(product_url) = '';

UPDATE historical_term_deposit_rates
SET product_url = source_url
WHERE product_url IS NULL OR TRIM(product_url) = '';

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
    product_url,
    published_at,
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
  product_url,
  published_at,
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
  source_url,
  product_url,
  published_at,
  data_quality_flag,
  confidence_score,
  retrieval_type,
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
    product_url,
    published_at,
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
  product_url,
  published_at,
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
  source_url,
  product_url,
  published_at,
  data_quality_flag,
  confidence_score,
  retrieval_type,
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
    product_url,
    published_at,
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
  product_url,
  published_at,
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
  source_url,
  product_url,
  published_at,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key
FROM historical_term_deposit_rates;

PRAGMA foreign_keys = ON;
