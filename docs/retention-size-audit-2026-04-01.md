# Retention Size Audit

- Generated: `2026-04-01T05:04:56.736Z`
- Current DB size: `725.516 MB`
- Current backend retention: `1` day(s)
- Fetch-events retention: `3650` day(s)
- Evidence backfill complete: `no`
- Recommended run-state retention: `7` day(s) (daily_evidence_not_backfilled)

## Candidate Projections

- 7 days: +11205 rows, +2.631 MB (2.63 MB)
- 14 days: +24278 rows, +5.701 MB (5.70 MB)
- 30 days: +54158 rows, +12.718 MB (12.72 MB)

## Tables

- run_reports: rows=2 bytes=2294 avg_rows/day=2 avg_bytes/day=2294 confidence=low
- lender_dataset_runs: rows=51 bytes=7305 avg_rows/day=25.5 avg_bytes/day=3652.5 confidence=low
- run_seen_products: rows=635 bytes=106508 avg_rows/day=317.5 avg_bytes/day=53254 confidence=low
- run_seen_series: rows=3045 bytes=758715 avg_rows/day=1522.5 avg_bytes/day=379357.5 confidence=low
- historical_provenance_recovery_log: rows=139256 bytes=115969194 avg_rows/day=139256 avg_bytes/day=115969194 confidence=low
- download_change_feed: rows=9817 bytes=3406371 avg_rows/day=9817 avg_bytes/day=3406371 confidence=low
- client_historical_runs: rows=357 bytes=95505 avg_rows/day=178.5 avg_bytes/day=47752.5 confidence=low
- client_historical_tasks: rows=5712 bytes=1616139 avg_rows/day=47.6 avg_bytes/day=13467.825 confidence=high
- client_historical_batches: rows=0 bytes=0 avg_rows/day=0 avg_bytes/day=0 confidence=low

