-- Client-assisted historical pull orchestration tables.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS client_historical_runs (
  run_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('public', 'admin')),
  product_scope TEXT NOT NULL DEFAULT 'all',
  run_source TEXT NOT NULL DEFAULT 'manual' CHECK (run_source IN ('scheduled', 'manual')),
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed')),
  total_tasks INTEGER NOT NULL DEFAULT 0 CHECK (total_tasks >= 0),
  pending_tasks INTEGER NOT NULL DEFAULT 0 CHECK (pending_tasks >= 0),
  claimed_tasks INTEGER NOT NULL DEFAULT 0 CHECK (claimed_tasks >= 0),
  completed_tasks INTEGER NOT NULL DEFAULT 0 CHECK (completed_tasks >= 0),
  failed_tasks INTEGER NOT NULL DEFAULT 0 CHECK (failed_tasks >= 0),
  mortgage_rows INTEGER NOT NULL DEFAULT 0 CHECK (mortgage_rows >= 0),
  savings_rows INTEGER NOT NULL DEFAULT 0 CHECK (savings_rows >= 0),
  td_rows INTEGER NOT NULL DEFAULT 0 CHECK (td_rows >= 0),
  requested_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_historical_runs_status_created
  ON client_historical_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_historical_runs_trigger_created
  ON client_historical_runs(trigger_source, created_at DESC);

CREATE TABLE IF NOT EXISTS client_historical_tasks (
  task_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  lender_code TEXT NOT NULL,
  collection_date TEXT NOT NULL CHECK (collection_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
  claimed_by TEXT,
  claimed_at TEXT,
  claim_expires_at TEXT,
  completed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  mortgage_rows INTEGER NOT NULL DEFAULT 0 CHECK (mortgage_rows >= 0),
  savings_rows INTEGER NOT NULL DEFAULT 0 CHECK (savings_rows >= 0),
  td_rows INTEGER NOT NULL DEFAULT 0 CHECK (td_rows >= 0),
  had_signals INTEGER NOT NULL DEFAULT 0 CHECK (had_signals IN (0, 1)),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES client_historical_runs(run_id) ON DELETE CASCADE,
  UNIQUE (run_id, lender_code, collection_date)
);

CREATE INDEX IF NOT EXISTS idx_client_historical_tasks_run_status_claim
  ON client_historical_tasks(run_id, status, claim_expires_at, collection_date DESC, lender_code ASC);

CREATE INDEX IF NOT EXISTS idx_client_historical_tasks_status_updated
  ON client_historical_tasks(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS client_historical_batches (
  batch_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  worker_id TEXT,
  payload_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES client_historical_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES client_historical_tasks(task_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_historical_batches_run_task
  ON client_historical_batches(run_id, task_id, created_at DESC);
