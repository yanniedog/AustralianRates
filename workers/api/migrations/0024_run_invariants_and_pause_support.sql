ALTER TABLE lender_dataset_runs
  ADD COLUMN index_fetch_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (index_fetch_succeeded IN (0, 1));

ALTER TABLE lender_dataset_runs
  ADD COLUMN accepted_row_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_row_count >= 0);

ALTER TABLE lender_dataset_runs
  ADD COLUMN written_row_count INTEGER NOT NULL DEFAULT 0 CHECK (written_row_count >= 0);

ALTER TABLE lender_dataset_runs
  ADD COLUMN dropped_row_count INTEGER NOT NULL DEFAULT 0 CHECK (dropped_row_count >= 0);

ALTER TABLE lender_dataset_runs
  ADD COLUMN detail_fetch_event_count INTEGER NOT NULL DEFAULT 0 CHECK (detail_fetch_event_count >= 0);

ALTER TABLE lender_dataset_runs
  ADD COLUMN lineage_error_count INTEGER NOT NULL DEFAULT 0 CHECK (lineage_error_count >= 0);

CREATE INDEX IF NOT EXISTS idx_lender_dataset_runs_run_invariants
  ON lender_dataset_runs(
    run_id,
    index_fetch_succeeded,
    expected_detail_count,
    written_row_count,
    lineage_error_count
  );
