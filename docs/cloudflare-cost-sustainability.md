# Cloudflare Cost Sustainability

Target: keep the production bill under USD 20/month by keeping Workers Paid as the main fixed cost and preventing public traffic or routine automation from consuming hot D1 reads/writes.

## Implemented Guardrails

- Production crons are limited to one Melbourne-gated daily CDR ingest and one daily public package refresh.
- Site health, hourly maintenance, hourly chart cache rebuild, integrity audit, daily backup, historical quality, and monthly export remain manual/admin paths.
- Scheduled ingest prelude audits and product-classification audits are feature-flagged off by default.
- Scheduled and queue handlers wrap `env.DB` with a daily D1 budget tracker. Daily CDR ingest remains essential; nonessential scheduled jobs stop once the configured fraction of budget is reached.
- D1 log persistence is warn/error only, with isolate-local repeated-message sampling. Info/debug logs still go to console but do not create `global_log` rows.
- Success probe payload capture is disabled. Failure captures remain available for diagnostics.
- Replay queue dispatch no longer runs on every scheduled event.
- Public snapshot/package requests are cache-only. If KV has no package, `/snapshot` returns `503 SNAPSHOT_PACKAGE_UNAVAILABLE` instead of querying D1.
- Frontend snapshottable public requests fail closed when the package is unavailable instead of falling through to `/filters`, `/latest-all`, `/analytics/series`, or `/analytics/report-plot`.

## Production Schedule

| Cron | Purpose | Cost posture |
| --- | --- | --- |
| `0 19,20 * * *` | Daily CDR ingest, gated to Melbourne 06:00 by `MELBOURNE_DAILY_INGEST_HOURS=6` | Essential |
| `0 23 * * *` | Public package refresh to `CHART_CACHE_KV` | Essential |

`CHART_CACHE_KV_TTL` is 129600 seconds (36 hours), so one missed package refresh does not immediately push public users back to D1.

## Required Next Phases

1. Replace daily duplicate historical D1 row writes with v2 interval/event storage:
   `collection_runs`, `lender_dataset_snapshots`, `current_series_state`, `rate_intervals`, `rate_events`, and `public_package_versions`.
2. Store raw CDR detail bodies and daily manifests in R2 by content hash. Write D1 only when normalized product/rate state changes.
3. Replace the current snapshot payload with a smaller package shape: `meta`, `dict`, `hierarchy`, `ribbon`, and minimal `current`.
4. Retire hot-path dependency on `chart_request_cache`, `snapshot_cache`, `report_plot_request_cache`, report deltas, high-frequency health/audit tables, and backup metadata.
5. Add automated acceptance tests that verify public package rendering makes no DB-backed endpoint waterfall.

## Operating Rule

If public packages are missing, rebuild packages or investigate the scheduled refresh. Do not re-enable public live D1 fallback as a quick fix; that recreates the bill-shock path.
