CREATE TABLE IF NOT EXISTS economic_series_observations_new (
  series_id TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  value REAL NOT NULL,
  source_url TEXT NOT NULL,
  release_date TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'monthly', 'quarterly', 'annual', 'policy')),
  proxy_flag INTEGER NOT NULL DEFAULT 0 CHECK (proxy_flag IN (0, 1)),
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes_json TEXT,
  PRIMARY KEY (series_id, observation_date)
) WITHOUT ROWID;

INSERT INTO economic_series_observations_new (
  series_id,
  observation_date,
  value,
  source_url,
  release_date,
  frequency,
  proxy_flag,
  fetched_at,
  notes_json
)
SELECT
  series_id,
  observation_date,
  value,
  source_url,
  release_date,
  frequency,
  proxy_flag,
  fetched_at,
  notes_json
FROM economic_series_observations;

DROP TABLE economic_series_observations;

ALTER TABLE economic_series_observations_new RENAME TO economic_series_observations;

CREATE INDEX IF NOT EXISTS idx_economic_observations_date
  ON economic_series_observations(observation_date DESC, series_id);
