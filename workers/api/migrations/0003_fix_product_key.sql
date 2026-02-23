-- Widen the unique constraint to include security_purpose and repayment_type.
-- The old constraint allowed silent overwrites when the same product had
-- different rate variants (e.g. owner-occupied P&I vs investment IO).

-- Step 1: Drop the old narrow unique index
DROP INDEX IF EXISTS sqlite_autoindex_historical_loan_rates_1;

-- SQLite cannot ALTER a constraint, so we recreate the table.
-- Preserve all data via a temp copy.

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
  UNIQUE(bank_name, collection_date, product_id, lvr_tier, rate_structure, security_purpose, repayment_type)
);

INSERT INTO historical_loan_rates_new
  SELECT * FROM historical_loan_rates;

DROP TABLE historical_loan_rates;
ALTER TABLE historical_loan_rates_new RENAME TO historical_loan_rates;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_collection_date
  ON historical_loan_rates(collection_date);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_bank_date
  ON historical_loan_rates(bank_name, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_product
  ON historical_loan_rates(product_id, rate_structure, lvr_tier);

-- Step 2: Rebuild vw_latest_rates with 6-part product_key and corrected PARTITION BY
DROP VIEW IF EXISTS vw_latest_rates;
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
  parsed_at,
  product_key
FROM ranked
WHERE row_num = 1;

-- Step 3: Rebuild vw_rate_timeseries with all fields and 6-part product_key
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
  interest_rate,
  comparison_rate,
  annual_fee,
  data_quality_flag,
  confidence_score,
  source_url,
  bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key
FROM historical_loan_rates;
