-- Track current product presence per section/bank/product so removed products can be surfaced explicitly.

CREATE TABLE IF NOT EXISTS product_presence_status (
  section TEXT NOT NULL CHECK (section IN ('home_loans', 'savings', 'term_deposits')),
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0, 1)),
  removed_at TEXT,
  last_seen_collection_date TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_run_id TEXT,
  PRIMARY KEY (section, bank_name, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_presence_status_section_removed
  ON product_presence_status(section, is_removed, bank_name);

CREATE INDEX IF NOT EXISTS idx_product_presence_status_last_seen
  ON product_presence_status(section, bank_name, last_seen_collection_date DESC, last_seen_at DESC);
