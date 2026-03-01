ALTER TABLE global_log ADD COLUMN code TEXT;

CREATE INDEX IF NOT EXISTS idx_global_log_code_ts
  ON global_log(code, ts DESC);

CREATE TABLE IF NOT EXISTS health_check_runs (
  run_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')),
  overall_ok INTEGER NOT NULL CHECK (overall_ok IN (0, 1)),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  components_json TEXT NOT NULL,
  integrity_json TEXT NOT NULL,
  e2e_aligned INTEGER NOT NULL CHECK (e2e_aligned IN (0, 1)),
  e2e_reason_code TEXT,
  e2e_reason_detail TEXT,
  actionable_json TEXT NOT NULL DEFAULT '[]',
  failures_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_health_check_runs_checked_at
  ON health_check_runs(checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_check_runs_overall_ok_checked_at
  ON health_check_runs(overall_ok, checked_at DESC);
