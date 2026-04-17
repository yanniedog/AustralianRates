-- Precomputed per-section page snapshot: bundles the small "waterfall" dependencies
-- (site-ui, filters, overview, latest-all, changes, exec-summary, rba/cpi history, report-plot moves+bands)
-- into one JSON payload so the public site can render the default view with a single request.
-- Refreshed hourly by the chart cache cron alongside chart_request_cache / report_plot_request_cache.

CREATE TABLE IF NOT EXISTS snapshot_cache (
  section TEXT NOT NULL,
  request_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  built_at TEXT NOT NULL,
  PRIMARY KEY (section, request_scope)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_cache_built_at
  ON snapshot_cache(built_at);
