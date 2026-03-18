-- One row per (product_key, collection_date) for front-end data.
-- Drops run_source from UNIQUE so at most one row per product per day.
-- Dedupe: prefer run_source='scheduled', then latest parsed_at.
-- Repopulate latest_* from deduplicated historical.

PRAGMA foreign_keys = OFF;

DROP VIEW IF EXISTS vw_latest_rates;
DROP VIEW IF EXISTS vw_rate_timeseries;
DROP VIEW IF EXISTS vw_latest_savings_rates;
DROP VIEW IF EXISTS vw_savings_timeseries;
DROP VIEW IF EXISTS vw_latest_td_rates;
DROP VIEW IF EXISTS vw_td_timeseries;

DROP TRIGGER IF EXISTS check_loan_rates_insert;
DROP TRIGGER IF EXISTS check_loan_rates_update;
DROP TRIGGER IF EXISTS check_savings_rates_insert;
DROP TRIGGER IF EXISTS check_savings_rates_update;
DROP TRIGGER IF EXISTS check_td_rates_insert;
DROP TRIGGER IF EXISTS check_td_rates_update;

-- ========== historical_loan_rates: new UNIQUE without run_source ==========
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
  lvr_tier TEXT NOT NULL CHECK (lvr_tier IN ('lvr_=60%', 'lvr_60-70%', 'lvr_70-80%', 'lvr_80-85%', 'lvr_85-90%', 'lvr_90-95%')),
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
  UNIQUE(bank_name, collection_date, product_id, security_purpose, repayment_type, lvr_tier, rate_structure)
);

INSERT INTO historical_loan_rates_new (
  bank_name, collection_date, product_id, product_name, product_code, series_key,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at,
  cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
  parsed_at, fetch_event_id, run_id, run_source
)
SELECT
  bank_name, collection_date, product_id, product_name, product_code, series_key,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at,
  cdr_product_detail_hash, data_quality_flag, confidence_score, retrieval_type,
  parsed_at, fetch_event_id, run_id, run_source
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, collection_date, product_id, security_purpose, repayment_type, lvr_tier, rate_structure
      ORDER BY (CASE WHEN run_source = 'scheduled' THEN 0 ELSE 1 END), parsed_at DESC
    ) AS row_num
  FROM historical_loan_rates
)
WHERE row_num = 1;

DROP TABLE historical_loan_rates;
ALTER TABLE historical_loan_rates_new RENAME TO historical_loan_rates;

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_collection_date ON historical_loan_rates(collection_date);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_bank_date ON historical_loan_rates(bank_name, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_product ON historical_loan_rates(product_id, rate_structure, lvr_tier);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_run_source ON historical_loan_rates(run_source, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_series_key ON historical_loan_rates(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_retrieval_date ON historical_loan_rates(retrieval_type, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_search ON historical_loan_rates(run_source, collection_date DESC, bank_name, security_purpose, repayment_type, rate_structure, lvr_tier, feature_set);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_latest_key ON historical_loan_rates(bank_name, product_id, security_purpose, repayment_type, lvr_tier, rate_structure, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_cdr_detail_hash ON historical_loan_rates(cdr_product_detail_hash);

-- ========== historical_savings_rates: new UNIQUE without run_source ==========
CREATE TABLE historical_savings_rates_new (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_code TEXT,
  series_key TEXT,
  account_type TEXT NOT NULL CHECK (account_type IN ('savings', 'transaction', 'at_call')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('base', 'bonus', 'introductory', 'bundle', 'total')),
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL DEFAULT 'all',
  min_balance REAL,
  max_balance REAL,
  conditions TEXT,
  monthly_fee REAL,
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
  UNIQUE(bank_name, collection_date, product_id, account_type, rate_type, deposit_tier)
);

INSERT INTO historical_savings_rates_new (
  bank_name, collection_date, product_id, product_name, product_code, series_key,
  account_type, rate_type, interest_rate, deposit_tier, min_balance, max_balance, conditions, monthly_fee,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, fetch_event_id, run_id, run_source
)
SELECT
  bank_name, collection_date, product_id, product_name, product_code, series_key,
  account_type, rate_type, interest_rate, deposit_tier, min_balance, max_balance, conditions, monthly_fee,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, fetch_event_id, run_id, run_source
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, collection_date, product_id, account_type, rate_type, deposit_tier
      ORDER BY (CASE WHEN run_source = 'scheduled' THEN 0 ELSE 1 END), parsed_at DESC
    ) AS row_num
  FROM historical_savings_rates
)
WHERE row_num = 1;

DROP TABLE historical_savings_rates;
ALTER TABLE historical_savings_rates_new RENAME TO historical_savings_rates;

CREATE INDEX IF NOT EXISTS idx_savings_collection_date ON historical_savings_rates(collection_date);
CREATE INDEX IF NOT EXISTS idx_savings_bank_date ON historical_savings_rates(bank_name, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_savings_product ON historical_savings_rates(product_id, account_type, rate_type, deposit_tier);
CREATE INDEX IF NOT EXISTS idx_savings_run_source ON historical_savings_rates(run_source, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_savings_search ON historical_savings_rates(run_source, collection_date DESC, bank_name, account_type, rate_type, deposit_tier);
CREATE INDEX IF NOT EXISTS idx_historical_savings_rates_series_key ON historical_savings_rates(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_savings_rates_retrieval_date ON historical_savings_rates(retrieval_type, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_savings_rates_cdr_detail_hash ON historical_savings_rates(cdr_product_detail_hash);

-- ========== historical_term_deposit_rates: new UNIQUE without run_source ==========
CREATE TABLE historical_term_deposit_rates_new (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_code TEXT,
  series_key TEXT,
  term_months INTEGER NOT NULL,
  interest_rate REAL NOT NULL,
  deposit_tier TEXT NOT NULL DEFAULT 'all',
  min_deposit REAL,
  max_deposit REAL,
  interest_payment TEXT NOT NULL DEFAULT 'at_maturity' CHECK (interest_payment IN ('at_maturity', 'monthly', 'quarterly', 'annually')),
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
  UNIQUE(bank_name, collection_date, product_id, term_months, deposit_tier, interest_payment)
);

INSERT INTO historical_term_deposit_rates_new (
  bank_name, collection_date, product_id, product_name, product_code, series_key,
  term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, fetch_event_id, run_id, run_source
)
SELECT
  bank_name, collection_date, product_id, product_name, product_code, series_key,
  term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, fetch_event_id, run_id, run_source
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, collection_date, product_id, term_months, deposit_tier, interest_payment
      ORDER BY (CASE WHEN run_source = 'scheduled' THEN 0 ELSE 1 END), parsed_at DESC
    ) AS row_num
  FROM historical_term_deposit_rates
)
WHERE row_num = 1;

DROP TABLE historical_term_deposit_rates;
ALTER TABLE historical_term_deposit_rates_new RENAME TO historical_term_deposit_rates;

CREATE INDEX IF NOT EXISTS idx_td_collection_date ON historical_term_deposit_rates(collection_date);
CREATE INDEX IF NOT EXISTS idx_td_bank_date ON historical_term_deposit_rates(bank_name, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_td_product ON historical_term_deposit_rates(product_id, term_months, deposit_tier, interest_payment);
CREATE INDEX IF NOT EXISTS idx_td_run_source ON historical_term_deposit_rates(run_source, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_td_search ON historical_term_deposit_rates(run_source, collection_date DESC, bank_name, term_months, deposit_tier, interest_payment);
CREATE INDEX IF NOT EXISTS idx_historical_td_rates_series_key ON historical_term_deposit_rates(series_key, collection_date DESC, parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_td_rates_retrieval_date ON historical_term_deposit_rates(retrieval_type, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_td_rates_cdr_detail_hash ON historical_term_deposit_rates(cdr_product_detail_hash);

-- ========== Recreate triggers ==========
CREATE TRIGGER IF NOT EXISTS check_loan_rates_insert BEFORE INSERT ON historical_loan_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds') WHERE NEW.interest_rate < 0.5 OR NEW.interest_rate > 25;
  SELECT RAISE(ABORT, 'comparison_rate out of bounds') WHERE NEW.comparison_rate IS NOT NULL AND (NEW.comparison_rate < 0.5 OR NEW.comparison_rate > 30);
  SELECT RAISE(ABORT, 'annual_fee out of bounds') WHERE NEW.annual_fee IS NOT NULL AND (NEW.annual_fee < 0 OR NEW.annual_fee > 10000);
  SELECT RAISE(ABORT, 'collection_date invalid') WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;
CREATE TRIGGER IF NOT EXISTS check_loan_rates_update BEFORE UPDATE ON historical_loan_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds') WHERE NEW.interest_rate < 0.5 OR NEW.interest_rate > 25;
  SELECT RAISE(ABORT, 'comparison_rate out of bounds') WHERE NEW.comparison_rate IS NOT NULL AND (NEW.comparison_rate < 0.5 OR NEW.comparison_rate > 30);
  SELECT RAISE(ABORT, 'annual_fee out of bounds') WHERE NEW.annual_fee IS NOT NULL AND (NEW.annual_fee < 0 OR NEW.annual_fee > 10000);
  SELECT RAISE(ABORT, 'collection_date invalid') WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;
CREATE TRIGGER IF NOT EXISTS check_savings_rates_insert BEFORE INSERT ON historical_savings_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds') WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'monthly_fee out of bounds') WHERE NEW.monthly_fee IS NOT NULL AND (NEW.monthly_fee < 0 OR NEW.monthly_fee > 50);
  SELECT RAISE(ABORT, 'min_balance out of bounds') WHERE NEW.min_balance IS NOT NULL AND (NEW.min_balance < 0 OR NEW.min_balance > 100000000);
  SELECT RAISE(ABORT, 'max_balance out of bounds') WHERE NEW.max_balance IS NOT NULL AND (NEW.max_balance < 0 OR NEW.max_balance > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid') WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;
CREATE TRIGGER IF NOT EXISTS check_savings_rates_update BEFORE UPDATE ON historical_savings_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds') WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'monthly_fee out of bounds') WHERE NEW.monthly_fee IS NOT NULL AND (NEW.monthly_fee < 0 OR NEW.monthly_fee > 50);
  SELECT RAISE(ABORT, 'min_balance out of bounds') WHERE NEW.min_balance IS NOT NULL AND (NEW.min_balance < 0 OR NEW.min_balance > 100000000);
  SELECT RAISE(ABORT, 'max_balance out of bounds') WHERE NEW.max_balance IS NOT NULL AND (NEW.max_balance < 0 OR NEW.max_balance > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid') WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;
CREATE TRIGGER IF NOT EXISTS check_td_rates_insert BEFORE INSERT ON historical_term_deposit_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds') WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'term_months out of bounds') WHERE NEW.term_months < 1 OR NEW.term_months > 120;
  SELECT RAISE(ABORT, 'min_deposit out of bounds') WHERE NEW.min_deposit IS NOT NULL AND (NEW.min_deposit < 0 OR NEW.min_deposit > 100000000);
  SELECT RAISE(ABORT, 'max_deposit out of bounds') WHERE NEW.max_deposit IS NOT NULL AND (NEW.max_deposit < 0 OR NEW.max_deposit > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid') WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;
CREATE TRIGGER IF NOT EXISTS check_td_rates_update BEFORE UPDATE ON historical_term_deposit_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds') WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'term_months out of bounds') WHERE NEW.term_months < 1 OR NEW.term_months > 120;
  SELECT RAISE(ABORT, 'min_deposit out of bounds') WHERE NEW.min_deposit IS NOT NULL AND (NEW.min_deposit < 0 OR NEW.min_deposit > 100000000);
  SELECT RAISE(ABORT, 'max_deposit out of bounds') WHERE NEW.max_deposit IS NOT NULL AND (NEW.max_deposit < 0 OR NEW.max_deposit > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid') WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

-- ========== Recreate views ==========
CREATE VIEW vw_latest_rates AS
WITH ranked AS (
  SELECT *, bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key,
    ROW_NUMBER() OVER (PARTITION BY bank_name, product_id, security_purpose, repayment_type, lvr_tier, rate_structure ORDER BY collection_date DESC, parsed_at DESC) AS row_num
  FROM historical_loan_rates
)
SELECT bank_name, collection_date, product_id, product_name, security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source, product_key
FROM ranked WHERE row_num = 1;

CREATE VIEW vw_rate_timeseries AS
SELECT collection_date, bank_name, product_id, product_name, security_purpose, repayment_type, lvr_tier, rate_structure, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source,
  bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure AS product_key
FROM historical_loan_rates;

CREATE VIEW vw_latest_savings_rates AS
WITH ranked AS (
  SELECT *, bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier AS product_key,
    ROW_NUMBER() OVER (PARTITION BY bank_name, product_id, account_type, rate_type, deposit_tier ORDER BY collection_date DESC, parsed_at DESC) AS row_num
  FROM historical_savings_rates
)
SELECT bank_name, collection_date, product_id, product_name, account_type, rate_type, interest_rate, deposit_tier,
  min_balance, max_balance, conditions, monthly_fee, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source, product_key
FROM ranked WHERE row_num = 1;

CREATE VIEW vw_savings_timeseries AS
SELECT collection_date, bank_name, product_id, product_name, account_type, rate_type, interest_rate, deposit_tier,
  min_balance, max_balance, conditions, monthly_fee, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source,
  bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier AS product_key
FROM historical_savings_rates;

CREATE VIEW vw_latest_td_rates AS
WITH ranked AS (
  SELECT *, bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key,
    ROW_NUMBER() OVER (PARTITION BY bank_name, product_id, term_months, deposit_tier ORDER BY collection_date DESC, parsed_at DESC) AS row_num
  FROM historical_term_deposit_rates
)
SELECT bank_name, collection_date, product_id, product_name, term_months, interest_rate, deposit_tier,
  min_deposit, max_deposit, interest_payment, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source, product_key
FROM ranked WHERE row_num = 1;

CREATE VIEW vw_td_timeseries AS
SELECT collection_date, bank_name, product_id, product_name, term_months, interest_rate, deposit_tier,
  min_deposit, max_deposit, interest_payment, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source,
  bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier AS product_key
FROM historical_term_deposit_rates;

-- ========== Repopulate latest_* from deduplicated historical ==========
DELETE FROM latest_home_loan_series;
INSERT INTO latest_home_loan_series (
  series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source, is_removed, removed_at
)
SELECT series_key, bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure,
  bank_name, collection_date, product_id, COALESCE(product_code, product_id), product_name,
  security_purpose, repayment_type, rate_structure, lvr_tier, feature_set,
  interest_rate, comparison_rate, annual_fee, source_url, product_url, published_at, cdr_product_detail_hash,
  data_quality_flag, confidence_score, retrieval_type, parsed_at, run_id, run_source, 0, NULL
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS row_num FROM historical_loan_rates)
WHERE row_num = 1;

DELETE FROM latest_savings_series;
INSERT INTO latest_savings_series (
  series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
  account_type, rate_type, interest_rate, deposit_tier, min_balance, max_balance, conditions, monthly_fee,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, run_id, run_source, is_removed, removed_at
)
SELECT series_key, bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier,
  bank_name, collection_date, product_id, COALESCE(product_code, product_id), product_name,
  account_type, rate_type, interest_rate, deposit_tier, min_balance, max_balance, conditions, monthly_fee,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, run_id, run_source, 0, NULL
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS row_num FROM historical_savings_rates)
WHERE row_num = 1;

DELETE FROM latest_td_series;
INSERT INTO latest_td_series (
  series_key, product_key, bank_name, collection_date, product_id, product_code, product_name,
  term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, run_id, run_source, is_removed, removed_at
)
SELECT series_key, bank_name || '|' || product_id || '|' || term_months || '|' || deposit_tier,
  bank_name, collection_date, product_id, COALESCE(product_code, product_id), product_name,
  term_months, interest_rate, deposit_tier, min_deposit, max_deposit, interest_payment,
  source_url, product_url, published_at, cdr_product_detail_hash, data_quality_flag, confidence_score,
  retrieval_type, parsed_at, run_id, run_source, 0, NULL
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY collection_date DESC, parsed_at DESC) AS row_num FROM historical_term_deposit_rates)
WHERE row_num = 1;

PRAGMA foreign_keys = ON;
