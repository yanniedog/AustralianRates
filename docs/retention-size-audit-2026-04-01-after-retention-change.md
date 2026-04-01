# Retention Size Audit

- Generated: `2026-04-01T05:24:44.650Z`
- Current DB size: `731.234 MB`
- Current backend retention: `30` day(s)
- Fetch-events retention: `3650` day(s)
- Evidence backfill complete: `yes`
- Recommended run-state retention: `30` day(s) (projection_within_30_day_threshold)

## Candidate Projections

- 7 days: +0 rows, +0 MB (0 B)
- 14 days: +0 rows, +0 MB (0 B)
- 30 days: +0 rows, +0 MB (0 B)

## Tables

- run_reports: rows=2 bytes=2294 avg_rows/day=2 avg_bytes/day=2294 confidence=low
- lender_dataset_runs: rows=51 bytes=7305 avg_rows/day=25.5 avg_bytes/day=3652.5 confidence=low
- run_seen_products: rows=635 bytes=106508 avg_rows/day=317.5 avg_bytes/day=53254 confidence=low
- run_seen_series: rows=3045 bytes=758715 avg_rows/day=1522.5 avg_bytes/day=379357.5 confidence=low
- historical_provenance_recovery_log: rows=139256 bytes=115969194 avg_rows/day=139256 avg_bytes/day=115969194 confidence=low
- download_change_feed: rows=9817 bytes=3406371 avg_rows/day=9817 avg_bytes/day=3406371 confidence=low
- client_historical_runs: rows=360 bytes=96360 avg_rows/day=180 avg_bytes/day=48180 confidence=low
- client_historical_tasks: rows=5760 bytes=1629720 avg_rows/day=47.6033 avg_bytes/day=13468.7603 confidence=high
- client_historical_batches: rows=0 bytes=0 avg_rows/day=0 avg_bytes/day=0 confidence=low

