-- Drop fetch_events columns that are not used in WHERE/JOIN/ORDER and bloat the table.
-- body_bytes is redundant with raw_objects.body_bytes; response_headers_json, duration_ms, notes, job_kind are display-only.
-- SQLite 3.35+ (D1) supports ALTER TABLE ... DROP COLUMN.

ALTER TABLE fetch_events DROP COLUMN response_headers_json;
ALTER TABLE fetch_events DROP COLUMN body_bytes;
ALTER TABLE fetch_events DROP COLUMN duration_ms;
ALTER TABLE fetch_events DROP COLUMN notes;
ALTER TABLE fetch_events DROP COLUMN job_kind;
