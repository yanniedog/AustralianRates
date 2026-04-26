# Cloudflare Cost Sustainability

Target: keep routine usage inside Cloudflare Workers Paid included quotas where possible. If D1 overage is required to preserve continuous daily CDR coverage, up to about USD 20/month is acceptable.

Primary invariant: daily CDR coverage must run every Melbourne day. Cost guardrails may pause public live fallbacks, diagnostics, exports, audits, backfills, repairs, and cache rebuilds, but they must not block the daily CDR ingest path.

## Implemented Guardrails

- Production crons are limited to one Melbourne-gated daily CDR ingest and one daily public package refresh.
- Site health, hourly maintenance, hourly chart cache rebuild, integrity audit, daily backup, historical quality, and monthly export remain manual/admin paths.
- Scheduled ingest prelude audits and product-classification audits are feature-flagged off by default.
- Fetch, scheduled, and queue handlers wrap `env.DB`/`env.READ_DB` with an advisory D1 usage tracker. Work is classified as `critical_coverage`, `essential_serving`, `deferable`, or `nonessential`.
- Daily CDR ingest is `critical_coverage`; it bypasses D1 budget shutoffs. High usage puts the site into coverage-minimal posture: keep daily coverage/provenance, pause enrichment, repair, exports, audits, backfills, diagnostics, and public live D1 fallback.
- Guardrail thresholds are based on projected monthly included quota use: warn at 60%, restrict nonessential work at 80%, disable public live D1 fallback at 90%. Coverage remains protected.
- D1 log persistence is warn/error only, with isolate-local repeated-message sampling. Info/debug logs still go to console but do not create `global_log` rows.
- Success probe payload capture is disabled. Failure captures remain available for diagnostics.
- Replay queue dispatch no longer runs on every scheduled event.
- Public snapshot/package requests are KV/cache first. If usage is healthy, bounded best-effort live compute can fill missing cache entries; after the 90% projected threshold, public live D1 fallback returns a stale/unavailable state instead of waterfalling through D1.
- The daily public package refresh is essential serving work: it refreshes all selectable public chart windows for home loans, savings, and term deposits into `CHART_CACHE_KV`. During D1 emergency minimum-write mode it still runs, but replay maintenance and persistent/hard-failure assurance side effects are suppressed.
- Frontend snapshottable public requests should fail closed when the package is unavailable instead of falling through to `/filters`, `/latest-all`, `/analytics/series`, or `/analytics/report-plot`.
- Admin D1 usage is available at `GET /api/home-loan-rates/admin/cloudflare/d1-usage?days=84` and `/admin/d1-usage.html`. Cloudflare GraphQL is the billing-grade source within the account analytics retention window; local KV tracking is advisory fallback. The admin page rolls up current and recent historical cost by the account billing cycle start day (`CLOUDFLARE_BILLING_CYCLE_START_DAY`, default `21`) and prices overage in whole per-million billing units to match Cloudflare billable usage.

## Production Schedule

| Cron | Purpose | Cost posture |
| --- | --- | --- |
| `0 19,20 * * *` | Daily CDR ingest, gated to Melbourne 06:00 by `MELBOURNE_DAILY_INGEST_HOURS=6` | Essential |
| `0 23 * * *` | Public package refresh to `CHART_CACHE_KV` for all public chart windows across home loans, savings, and term deposits | Essential |

`CHART_CACHE_KV_TTL` is 129600 seconds (36 hours), so one missed package refresh does not immediately push public users back to D1.

## Required Next Phases

1. Make ingest change-aware where safe: unchanged product/rate states should avoid duplicate derived writes while still recording that each lender/dataset was checked daily.
2. Replace daily duplicate historical D1 row writes with v2 interval/event storage:
   `collection_runs`, `lender_dataset_snapshots`, `current_series_state`, `rate_intervals`, `rate_events`, and `public_package_versions`.
3. Store raw CDR detail bodies and daily manifests in R2 by content hash. Write D1 only when normalized product/rate state changes.
4. Replace the current snapshot payload with a smaller package shape: `meta`, `dict`, `hierarchy`, `ribbon`, and minimal `current`.
5. Retire hot-path dependency on `chart_request_cache`, `snapshot_cache`, `report_plot_request_cache`, report deltas, high-frequency health/audit tables, and backup metadata.
6. Add automated acceptance tests that verify public package rendering makes no DB-backed endpoint waterfall.

## Operating Rule

Never disable daily CDR ingest for cost. Never skip the daily KV public package refresh solely because `D1_EMERGENCY_MINIMUM_WRITES` is enabled; suppress write-producing side effects instead. If public packages are missing, rebuild packages or investigate the scheduled refresh. Do not re-enable unrestricted public live D1 fallback as a quick fix; that recreates the bill-shock path.

Use `POST /api/home-loan-rates/admin/public-packages/refresh` for the bounded public-window refresh. Add `?full=1` only for a deliberate all-scope rebuild.

## Underused Cloudflare Allowances

- **KV:** Use for hot public packages. Workers Paid includes 10M reads/month, 1M writes/month, and 1GB storage; this is the preferred serving layer for chart/report bundles.
- **R2:** Use next for raw CDR bodies, daily manifests, and package artifacts. Standard R2 includes 10GB storage, 1M Class A ops, 10M Class B ops, and free egress.
- **Durable Objects:** Keep as a later coordination option. SQLite-backed storage row billing mirrors D1-style row accounting, so it is not the immediate answer for analytical history.
