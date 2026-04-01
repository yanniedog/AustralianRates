CREATE TABLE IF NOT EXISTS historical_quality_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_run_id TEXT NOT NULL,
  stable_finding_key TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('overall', 'home_loans', 'savings', 'term_deposits')),
  dataset_kind TEXT CHECK (dataset_kind IN ('home_loans', 'savings', 'term_deposits')),
  criterion_code TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('day', 'product', 'series', 'product_family', 'lender_dataset')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'severe')),
  severity_weight REAL NOT NULL,
  origin_class TEXT NOT NULL DEFAULT 'unknown' CHECK (origin_class IN ('internal', 'external', 'market', 'unknown')),
  origin_confidence REAL NOT NULL DEFAULT 0,
  bank_name TEXT,
  lender_code TEXT,
  product_id TEXT,
  product_name TEXT,
  series_key TEXT,
  summary TEXT NOT NULL,
  explanation TEXT NOT NULL,
  source_ingest_anomaly_id INTEGER,
  sample_identifiers_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  drilldown_sql_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (audit_run_id, stable_finding_key),
  FOREIGN KEY (audit_run_id) REFERENCES historical_quality_runs(audit_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_historical_quality_findings_date_scope
  ON historical_quality_findings(collection_date DESC, scope, severity_weight DESC);

CREATE INDEX IF NOT EXISTS idx_historical_quality_findings_series
  ON historical_quality_findings(series_key, criterion_code, collection_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_quality_findings_run_key
  ON historical_quality_findings(audit_run_id, stable_finding_key);
