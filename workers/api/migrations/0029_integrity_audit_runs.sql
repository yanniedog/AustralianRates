-- Store data integrity audit runs for admin UI and daily cron.

CREATE TABLE IF NOT EXISTS integrity_audit_runs (
  run_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')),
  overall_ok INTEGER NOT NULL CHECK (overall_ok IN (0, 1)),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('green', 'amber', 'red')),
  summary_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_integrity_audit_runs_checked_at
  ON integrity_audit_runs(checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_audit_runs_status_checked_at
  ON integrity_audit_runs(status, checked_at DESC);
