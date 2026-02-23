CREATE TABLE IF NOT EXISTS global_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')) DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'api',
  message TEXT NOT NULL,
  context TEXT,
  run_id TEXT,
  lender_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_global_log_ts
  ON global_log(ts DESC);

CREATE INDEX IF NOT EXISTS idx_global_log_level
  ON global_log(level, ts DESC);

CREATE INDEX IF NOT EXISTS idx_global_log_source
  ON global_log(source, ts DESC);
