CREATE TABLE IF NOT EXISTS economic_series_observations (
  series_id TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  value REAL NOT NULL,
  source_url TEXT NOT NULL,
  release_date TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'monthly', 'quarterly', 'policy')),
  proxy_flag INTEGER NOT NULL DEFAULT 0 CHECK (proxy_flag IN (0, 1)),
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes_json TEXT,
  PRIMARY KEY (series_id, observation_date)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_economic_observations_date
  ON economic_series_observations(observation_date DESC, series_id);

CREATE TABLE IF NOT EXISTS economic_series_status (
  series_id TEXT PRIMARY KEY,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_observation_date TEXT,
  last_value REAL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'stale', 'error')),
  message TEXT,
  source_url TEXT NOT NULL,
  proxy_flag INTEGER NOT NULL DEFAULT 0 CHECK (proxy_flag IN (0, 1))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_economic_status_status
  ON economic_series_status(status, last_checked_at DESC);
