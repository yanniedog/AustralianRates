-- Add run_id and run_source to historical_loan_rates so each row is
-- linked to the run that produced it and tagged as scheduled or manual.
-- Widen the unique constraint to include run_source so that a manual run
-- and a scheduled run on the same day can coexist as separate rows.

-- Also add run_source to run_reports.

-- 1. Drop views that reference the table we are about to recreate.
DROP VIEW IF EXISTS vw_latest_rates;
DROP VIEW IF EXISTS vw_rate_timeseries;

-- 2. Recreate historical_loan_rates with the two new columns.
CREATE TABLE historical_loan_rates_new (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  security_purpose TEXT NOT NULL CHECK (security_purpose IN ('owner_occupied', 'investment')),
  repayment_type TEXT NOT NULL CHECK (repayment_type IN ('principal_and_interest', 'interest_only')),
  rate_structure TEXT NOT NULL CHECK (rate_structure IN ('variable', 'fixed_1yr', 'fixed_2yr', 'fixed_3yr', 'fixed_4yr', 'fixed_5yr')),
  lvr_tier TEXT NOT NULL CHECK (lvr_tier IN ('lvr_=60%', 'lvr_60-70%', 'lvr_70-80%', 'lvr_80-85%', 'lvr_85-90%', 'lvr_90-95%')),
  feature_set TEXT NOT NULL CHECK (feature_set IN ('basic', 'premium')),
  interest_rate REAL NOT NULL,
  comparison_rate REAL,
  annual_fee REAL,
  source_url TEXT NOT NULL,
  data_quality_flag TEXT NOT NULL DEFAULT 'ok',
  confidence_score REAL NOT NULL DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  parsed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_id TEXT,
  run_source TEXT NOT NULL DEFAULT 'scheduled' CHECK (run_source IN ('scheduled', 'manual')),
  UNIQUE(bank_name, collection_date, product_id, lvr_tier, rate_structure, security_purpose, repayment_type, run_source)
);

-- 3. Copy existing data. New columns get defaults (run_id = NULL, run_source = 'scheduled').
INSERT INTO historical_loan_rates_new (
  bank_name, collection_date, product_id, product_name,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url,
  data_quality_flag, confidence_score, parsed_at
)
SELECT
  bank_name, collection_date, product_id, product_name,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url,
  data_quality_flag, confidence_score, parsed_at
FROM historical_loan_rates;

DROP TABLE historical_loan_rates;
ALTER TABLE historical_loan_rates_new RENAME TO historical_loan_rates;

-- 4. Recreate indexes.
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_collection_date
  ON historical_loan_rates(collection_date);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_bank_date
  ON historical_loan_rates(bank_name, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_product
  ON historical_loan_rates(product_id, rate_structure, lvr_tier);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_run_source
  ON historical_loan_rates(run_source, collection_date DESC);

-- 5. Rebuild vw_latest_rates with run_id and run_source.
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
    parsed_at,
    run_id,
    run_source,
    bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, security_purpose, repayment_type, lvr_tier, rate_structure
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_loan_rates
  WHERE run_source != 'manual'
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
  parsed_at,
  run_id,
  run_source,
  product_key
FROM ranked
WHERE row_num = 1;

-- 6. Rebuild vw_rate_timeseries with run_id and run_source.
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
  source_url,
  parsed_at,
  run_id,
  run_source,
  bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key
FROM historical_loan_rates;

-- 7. Add run_source to run_reports.
ALTER TABLE run_reports ADD COLUMN run_source TEXT NOT NULL DEFAULT 'scheduled';
