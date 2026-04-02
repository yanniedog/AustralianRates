CREATE TABLE IF NOT EXISTS chart_request_cache (
  section TEXT NOT NULL,
  representation TEXT NOT NULL CHECK (representation IN ('day', 'change')),
  request_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  built_at TEXT NOT NULL,
  PRIMARY KEY (section, representation, request_scope)
);

CREATE INDEX IF NOT EXISTS idx_chart_request_cache_built_at
  ON chart_request_cache(built_at);
