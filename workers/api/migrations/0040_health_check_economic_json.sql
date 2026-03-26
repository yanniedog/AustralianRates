ALTER TABLE health_check_runs
  ADD COLUMN economic_json TEXT NOT NULL DEFAULT '{}';
