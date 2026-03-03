CREATE TABLE IF NOT EXISTS cdr_detail_payload_store (
  payload_hash TEXT PRIMARY KEY,
  encoding TEXT NOT NULL CHECK (encoding IN ('gzip')),
  payload_blob BLOB NOT NULL,
  uncompressed_bytes INTEGER NOT NULL CHECK (uncompressed_bytes >= 0),
  compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

ALTER TABLE historical_loan_rates
  ADD COLUMN cdr_product_detail_hash TEXT;

ALTER TABLE historical_savings_rates
  ADD COLUMN cdr_product_detail_hash TEXT;

ALTER TABLE historical_term_deposit_rates
  ADD COLUMN cdr_product_detail_hash TEXT;

ALTER TABLE latest_home_loan_series
  ADD COLUMN cdr_product_detail_hash TEXT;

ALTER TABLE latest_savings_series
  ADD COLUMN cdr_product_detail_hash TEXT;

ALTER TABLE latest_td_series
  ADD COLUMN cdr_product_detail_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_cdr_detail_hash
  ON historical_loan_rates(cdr_product_detail_hash);

CREATE INDEX IF NOT EXISTS idx_historical_savings_rates_cdr_detail_hash
  ON historical_savings_rates(cdr_product_detail_hash);

CREATE INDEX IF NOT EXISTS idx_historical_td_rates_cdr_detail_hash
  ON historical_term_deposit_rates(cdr_product_detail_hash);

CREATE INDEX IF NOT EXISTS idx_latest_home_loan_series_cdr_detail_hash
  ON latest_home_loan_series(cdr_product_detail_hash);

CREATE INDEX IF NOT EXISTS idx_latest_savings_series_cdr_detail_hash
  ON latest_savings_series(cdr_product_detail_hash);

CREATE INDEX IF NOT EXISTS idx_latest_td_series_cdr_detail_hash
  ON latest_td_series(cdr_product_detail_hash);
