CREATE TABLE IF NOT EXISTS rba_cash_rates (
  collection_date TEXT PRIMARY KEY,
  cash_rate REAL NOT NULL,
  effective_date TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rba_cash_rates_effective_date
  ON rba_cash_rates(effective_date DESC);
