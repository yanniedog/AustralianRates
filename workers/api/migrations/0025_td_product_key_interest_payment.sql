-- Restore the canonical term-deposit product_key identity.
-- product_key must distinguish interest payment frequency so longitudinal
-- queries and rate-change integrity checks do not collapse multiple series.

UPDATE latest_td_series
SET product_key = bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment
WHERE product_key != bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment;

DROP VIEW IF EXISTS vw_latest_td_rates;
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
    cdr_product_detail_hash,
    data_quality_flag,
    confidence_score,
    retrieval_type,
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment AS product_key,
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
  bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment AS product_key
FROM historical_term_deposit_rates;
