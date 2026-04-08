CREATE TABLE IF NOT EXISTS report_plot_refresh_locks (
  section TEXT NOT NULL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
