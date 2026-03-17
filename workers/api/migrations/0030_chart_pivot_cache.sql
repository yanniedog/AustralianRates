-- Slim precomputed cache for chart and pivot payloads. Refreshed by cron every 15 min.
-- One row per (section, representation); payload_json holds the full response rows.
CREATE TABLE IF NOT EXISTS chart_pivot_cache (
  section TEXT NOT NULL,
  representation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  built_at TEXT NOT NULL,
  PRIMARY KEY (section, representation)
);
