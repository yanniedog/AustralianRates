-- Repair confirmed production integrity-health rows discovered 2026-05-05.
-- 1. UBank home-loan rows were normalized to lvr_standard_reference but retained the old
--    lvr_unspecified series_key from before migration 0053.
-- 2. A small set of Westpac-group 12 month TD rows carried 0.1% outlier rates immediately
--    before valid 5.1% rows; quarantine the stale outliers so public charts and health
--    checks skip them without deleting provenance.

UPDATE historical_loan_rates
SET series_key = bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure
WHERE bank_name = 'UBank'
  AND product_id IS NOT NULL
  AND security_purpose IS NOT NULL
  AND repayment_type IS NOT NULL
  AND lvr_tier IS NOT NULL
  AND rate_structure IS NOT NULL
  AND TRIM(product_id) != ''
  AND TRIM(security_purpose) != ''
  AND TRIM(repayment_type) != ''
  AND TRIM(lvr_tier) != ''
  AND TRIM(rate_structure) != ''
  AND lvr_tier = 'lvr_standard_reference'
  AND series_key IS NOT NULL
  AND TRIM(series_key) != ''
  AND series_key != bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure;

UPDATE historical_term_deposit_rates
SET quarantine_reason = 'known_cdr_anomaly:td_zero_point_one_outlier',
    quarantined_at = COALESCE(quarantined_at, datetime('now'))
WHERE collection_date BETWEEN '2026-04-01' AND '2026-04-29'
  AND interest_rate = 0.1
  AND term_months = 12
  AND deposit_tier IN ('$1k-$2m', '$5k-$2m')
  AND interest_payment = 'at_maturity'
  AND (
    (bank_name = 'Bank of Melbourne' AND product_id IN ('BOMTDTermDeposit', 'BOMTDBusTermDeposit')) OR
    (bank_name = 'St. George Bank' AND product_id IN ('STGTDTermDeposit', 'STGTDBusTermDeposit')) OR
    (bank_name = 'Westpac Banking Corporation' AND product_id IN ('TDTermDeposit', 'TDBusTermDeposit'))
  )
  AND (quarantine_reason IS NULL OR TRIM(quarantine_reason) = '');
