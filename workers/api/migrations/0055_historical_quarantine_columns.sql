-- Explicit quarantine markers for historical rows.
-- This keeps anomalous rows queryable for diagnostics while allowing public/read paths
-- to exclude them deterministically.

ALTER TABLE historical_loan_rates ADD COLUMN quarantine_reason TEXT;
ALTER TABLE historical_loan_rates ADD COLUMN quarantined_at TEXT;

ALTER TABLE historical_savings_rates ADD COLUMN quarantine_reason TEXT;
ALTER TABLE historical_savings_rates ADD COLUMN quarantined_at TEXT;

ALTER TABLE historical_term_deposit_rates ADD COLUMN quarantine_reason TEXT;
ALTER TABLE historical_term_deposit_rates ADD COLUMN quarantined_at TEXT;

CREATE INDEX IF NOT EXISTS idx_hlr_quarantine_reason
  ON historical_loan_rates(quarantine_reason, collection_date DESC, series_key);
CREATE INDEX IF NOT EXISTS idx_hsr_quarantine_reason
  ON historical_savings_rates(quarantine_reason, collection_date DESC, series_key);
CREATE INDEX IF NOT EXISTS idx_htd_quarantine_reason
  ON historical_term_deposit_rates(quarantine_reason, collection_date DESC, series_key);
