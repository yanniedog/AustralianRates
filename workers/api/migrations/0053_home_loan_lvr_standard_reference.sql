-- Adds lvr_standard_reference for UBank (and similar) contract "standard variable rate"
-- footnote rows that are not LVR bands. Backfills historical UBank variable rows that were
-- stored as lvr_unspecified from the public HTML fallback.

PRAGMA foreign_keys = OFF;

DROP VIEW IF EXISTS vw_latest_rates;
DROP VIEW IF EXISTS vw_rate_timeseries;

CREATE TABLE historical_loan_rates_new (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_code TEXT,
  series_key TEXT,
  security_purpose TEXT NOT NULL CHECK (security_purpose IN ('owner_occupied', 'investment')),
  repayment_type TEXT NOT NULL CHECK (repayment_type IN ('principal_and_interest', 'interest_only')),
  rate_structure TEXT NOT NULL CHECK (rate_structure IN ('variable', 'fixed_1yr', 'fixed_2yr', 'fixed_3yr', 'fixed_4yr', 'fixed_5yr')),
  lvr_tier TEXT NOT NULL CHECK (
    lvr_tier IN (
      'lvr_unspecified',
      'lvr_standard_reference',
      'lvr_=60%',
      'lvr_60-70%',
      'lvr_70-80%',
      'lvr_80-85%',
      'lvr_85-90%',
      'lvr_90-95%'
    )
  ),
  feature_set TEXT NOT NULL CHECK (feature_set IN ('basic', 'premium')),
  interest_rate REAL NOT NULL,
  comparison_rate REAL,
  annual_fee REAL,
  source_url TEXT NOT NULL,
  product_url TEXT,
  published_at TEXT,
  cdr_product_detail_hash TEXT,
  data_quality_flag TEXT NOT NULL DEFAULT 'ok',
  confidence_score REAL NOT NULL DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  retrieval_type TEXT NOT NULL DEFAULT 'present_scrape_same_date',
  parsed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fetch_event_id INTEGER,
  run_id TEXT,
  run_source TEXT NOT NULL DEFAULT 'scheduled' CHECK (run_source IN ('scheduled', 'manual')),
  has_offset_account INTEGER CHECK (has_offset_account IN (0, 1) OR has_offset_account IS NULL),
  UNIQUE(bank_name, collection_date, product_id, security_purpose, repayment_type, lvr_tier, rate_structure)
);

INSERT INTO historical_loan_rates_new (
  bank_name,
  collection_date,
  product_id,
  product_name,
  product_code,
  series_key,
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
  cdr_product_detail_hash,
  data_quality_flag,
  confidence_score,
  retrieval_type,
  parsed_at,
  fetch_event_id,
  run_id,
  run_source,
  has_offset_account
)
SELECT
  bank_name,
  collection_date,
  product_id,
  product_name,
  product_code,
  series_key,
  security_purpose,
  repayment_type,
  rate_structure,
  CASE
    WHEN TRIM(CAST(bank_name AS TEXT)) = 'UBank'
      AND rate_structure = 'variable'
      AND lvr_tier = 'lvr_unspecified'
    THEN 'lvr_standard_reference'
    ELSE lvr_tier
  END AS lvr_tier,
  feature_set,
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
  fetch_event_id,
  run_id,
  run_source,
  has_offset_account
FROM historical_loan_rates;

DROP TABLE historical_loan_rates;
ALTER TABLE historical_loan_rates_new RENAME TO historical_loan_rates;

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_collection_date
  ON historical_loan_rates(collection_date);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_bank_date
  ON historical_loan_rates(bank_name, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_product
  ON historical_loan_rates(product_id, rate_structure, lvr_tier);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_run_source
  ON historical_loan_rates(run_source, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_series_key
  ON historical_loan_rates(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_retrieval_date
  ON historical_loan_rates(retrieval_type, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_search
  ON historical_loan_rates(run_source, collection_date DESC, bank_name, security_purpose, repayment_type, rate_structure, lvr_tier, feature_set);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_latest_key
  ON historical_loan_rates(bank_name, product_id, security_purpose, repayment_type, lvr_tier, rate_structure, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_cdr_detail_hash
  ON historical_loan_rates(cdr_product_detail_hash);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_offset_account
  ON historical_loan_rates(has_offset_account, collection_date DESC);

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

PRAGMA foreign_keys = ON;
