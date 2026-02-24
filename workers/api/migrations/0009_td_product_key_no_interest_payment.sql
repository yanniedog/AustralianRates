-- Fix term-deposit product_key: remove interest_payment so the same product
-- (bank|product_id|term_months|deposit_tier) is tracked longitudinally regardless
-- of interest payment frequency. Aligns with AGENTS.md longitudinal product identity.
DROP VIEW IF EXISTS vw_latest_td_rates;
DROP VIEW IF EXISTS vw_td_timeseries;

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
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key
FROM historical_term_deposit_rates;
