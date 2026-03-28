type ActionableIssue = {
  code: string
  title: string
  action: string
  links: string[]
}

export type ActionableIssueSummary = ActionableIssue & {
  count: number
  latest_ts: string | null
  latest_source: string | null
  latest_message: string | null
}

const DEFAULT_ISSUE: ActionableIssue = {
  code: 'unknown_issue',
  title: 'Unclassified operational issue',
  action: 'Review Logs first, then inspect Runs for related failures and retry if required.',
  links: ['/admin/logs.html', '/admin/runs.html'],
}

const ACTIONABLE_MAP: Record<string, ActionableIssue> = {
  queue_message_exhausted: {
    code: 'queue_message_exhausted',
    title: 'Queue retries exhausted',
    action: 'Inspect failure context, verify endpoint health, and trigger a manual run/backfill for impacted lenders.',
    links: ['/admin/logs.html', '/admin/runs.html'],
  },
  queue_message_failed: {
    code: 'queue_message_failed',
    title: 'Queue message failed',
    action: 'Check error context and retry behavior. If repeated, investigate upstream source quality and parser assumptions.',
    links: ['/admin/logs.html', '/admin/runs.html'],
  },
  upsert_failed: {
    code: 'upsert_failed',
    title: 'Database upsert failed',
    action: 'Validate schema constraints and row payload shape; confirm product identity fields are present.',
    links: ['/admin/database.html', '/admin/logs.html'],
  },
  write_contract_violation: {
    code: 'write_contract_violation',
    title: 'Write contract blocked questionable data',
    action: 'Inspect ingest anomalies, confirm fetch-event lineage and lender mapping, and repair the parser/source contract before allowing more writes.',
    links: ['/admin/status.html', '/admin/logs.html', '/admin/database.html'],
  },
  daily_run_failed: {
    code: 'daily_run_failed',
    title: 'Daily run failed',
    action: 'Review run report errors, verify scheduler/queue bindings, and re-run daily ingestion after fixing root cause.',
    links: ['/admin/runs.html', '/admin/logs.html'],
  },
  backfill_run_failed: {
    code: 'backfill_run_failed',
    title: 'Backfill run failed',
    action: 'Inspect historical task failures and re-trigger backfill with narrowed scope to isolate bad sources.',
    links: ['/admin/runs.html', '/admin/logs.html'],
  },
  historical_task_execute_failed: {
    code: 'historical_task_execute_failed',
    title: 'Historical task execute failed',
    action: 'Check error context (e.g. D1 schema: ensure migration 0031 applied; fetch_events must not reference dropped columns). Retry historical run or fix schema then re-run.',
    links: ['/admin/logs.html', '/admin/runs.html', '/admin/database.html'],
  },
  unknown_cron_expression: {
    code: 'unknown_cron_expression',
    title: 'Unexpected cron expression',
    action: 'Verify configured cron expressions in worker config and scheduler dispatch constants.',
    links: ['/admin/config.html', '/admin/logs.html'],
  },
  app_config_unavailable: {
    code: 'app_config_unavailable',
    title: 'App config table unavailable',
    action: 'Apply pending migrations and verify D1 binding/database health.',
    links: ['/admin/database.html', '/admin/logs.html'],
  },
  coverage_slo_breach: {
    code: 'coverage_slo_breach',
    title: 'Coverage gap audit detected lender/day gaps',
    action: 'Review coverage diagnostics, inspect replay backlog, and run targeted lender/day reconciliation for affected scope.',
    links: ['/admin/status.html', '/admin/runs.html'],
  },
  lender_universe_drift: {
    code: 'lender_universe_drift',
    title: 'Configured lender universe drifted from the register',
    action: 'Review lender universe diagnostics and update lender config or endpoint mappings before relying on completeness claims.',
    links: ['/admin/status.html', '/admin/config.html'],
  },
  replay_queue_incident_opened: {
    code: 'replay_queue_incident_opened',
    title: 'Replay queue exhausted its repair budget',
    action: 'Inspect replay queue diagnostics, investigate the failing lender/product scope, and run a forced lender/day reconciliation after fixing the root cause.',
    links: ['/admin/runs.html', '/admin/logs.html'],
  },
  replay_queue_dispatch_failed: {
    code: 'replay_queue_dispatch_failed',
    title: 'Replay queue dispatch failed',
    action: 'Check queue binding health and replay queue diagnostics, then retry replay dispatch.',
    links: ['/admin/runs.html', '/admin/logs.html'],
  },
  detail_fetch_failed: {
    code: 'detail_fetch_failed',
    title: 'CDR product detail fetch failed',
    action:
      'Check upstream CDR 4xx/5xx (400/406/500). Verify lender endpoint and x-v; for 400/406 confirm product ID is valid and still offered. Use admin logs and coverage-gap report.',
    links: ['/admin/logs.html', '/admin/status.html', '/admin/runs.html'],
  },
  lender_finalize_not_ready: {
    code: 'lender_finalize_not_ready',
    title: 'Lender finalize not ready (detail processing incomplete or failed)',
    action:
      'Read the sub-reason after the third colon (e.g. zero_accepted_rows_for_nonzero_expected_details = detail jobs finished but no row passed validation / parse produced no rows). Error suffix exp_acc_w_c_f_dfe is expected/accepted/written/completed/failed/detail_fetch_events. For zero_accepted, check dropped anomalies and live CDR detail shape. Otherwise resolve detail_fetch_failed or wait for detail jobs; check logs for lender_code and run_id.',
    links: ['/admin/logs.html', '/admin/runs.html'],
  },
  run_lifecycle_reconciliation_stalled: {
    code: 'run_lifecycle_reconciliation_stalled',
    title: 'Run lifecycle reconciliation stalled',
    action: 'Review run finalization and replay queue; ensure stale runs are closed or retried so reconciliation can progress.',
    links: ['/admin/runs.html', '/admin/logs.html'],
  },
  run_lifecycle_reconciliation_failed: {
    code: 'run_lifecycle_reconciliation_failed',
    title: 'Run lifecycle reconciliation threw',
    action:
      'Inspect log context/traceback (D1 schema vs query, finalization SQL). Use POST /runs/reconcile with dry_run to reproduce; verify lender_dataset_runs is WITHOUT ROWID and queries use primary key (run_id, lender_code, dataset_kind).',
    links: ['/admin/runs.html', '/admin/logs.html'],
  },
  analytics_change_query_failed: {
    code: 'analytics_change_query_failed',
    title: 'Analytics change query failed',
    action: 'Check analytics projection schema (e.g. home_loan_rate_events columns) and D1 migrations on the DB used for reads; apply 0026 or fix read DB schema.',
    links: ['/admin/database.html', '/admin/logs.html'],
  },
  analytics_change_query_schema_mismatch: {
    code: 'analytics_change_query_schema_mismatch',
    title: 'Analytics change query schema mismatch',
    action: 'Read DB or analytics table is missing columns (e.g. security_purpose). Apply migrations on the read DB or use a single DB; change endpoint will use legacy path until fixed.',
    links: ['/admin/database.html', '/admin/logs.html'],
  },
  cdr_audit_detected_gaps: {
    code: 'cdr_audit_detected_gaps',
    title: 'CDR audit detected gaps',
    action: 'Review CDR pipeline audit results: missing raw objects, fetch_event links, series_key, or presence tracking. Use admin CDR repair and coverage-gap report.',
    links: ['/admin/logs.html', '/admin/status.html', '/admin/runs.html'],
  },
  economic_series_fetch_failed: {
    code: 'economic_series_fetch_failed',
    title: 'Economic series upstream fetch failed',
    action:
      'Check RBA (or other) source URL reachability from Workers; transient 403/5xx may be bot-blocking—verify fetch headers and fallbacks. Review admin logs for series_id and message.',
    links: ['/admin/logs.html', '/admin/status.html'],
  },
  economic_series_parse_failed: {
    code: 'economic_series_parse_failed',
    title: 'Economic series parse failed after fetch',
    action: 'Inspect parser assumptions vs current CSV/HTML shape for the series_id in log context; fix parser or source URL in economic registry.',
    links: ['/admin/logs.html', '/admin/status.html'],
  },
  site_health_diagnostics: {
    code: 'site_health_diagnostics',
    title: 'Site health check reported attention needed',
    action:
      'Open admin Status, review economic coverage and E2E slices in the latest health run, and run POST /health/run if you need a fresh snapshot.',
    links: ['/admin/status.html', '/admin/logs.html'],
  },
}

function inferCodeFromMessage(message: string): string {
  const normalized = String(message || '').toLowerCase()
  if (normalized.includes('queue_message_exhausted')) return 'queue_message_exhausted'
  if (normalized.includes('queue_message_failed')) return 'queue_message_failed'
  if (normalized.includes('detail_fetch_failed')) return 'detail_fetch_failed'
  if (normalized.includes('lender_finalize_not_ready')) return 'lender_finalize_not_ready'
  if (normalized.includes('write_contract_violation')) return 'write_contract_violation'
  if (normalized.includes('upsert_failed')) return 'upsert_failed'
  if (normalized.includes('daily run') && normalized.includes('failed')) return 'daily_run_failed'
  if (normalized.includes('backfill run') && normalized.includes('failed')) return 'backfill_run_failed'
  if (normalized.includes('historical_task_execute failed')) return 'historical_task_execute_failed'
  if (normalized.includes('unknown cron expression')) return 'unknown_cron_expression'
  if (normalized.includes('app_config') && normalized.includes('unavailable')) return 'app_config_unavailable'
  if (normalized.includes('coverage_gap_audit_detected_gaps') || normalized.includes('coverage_slo_breach')) return 'coverage_slo_breach'
  if (normalized.includes('lender_universe') && normalized.includes('drift')) return 'lender_universe_drift'
  if (normalized.includes('replay_queue_incident_opened')) return 'replay_queue_incident_opened'
  if (normalized.includes('replay_queue_dispatch_failed')) return 'replay_queue_dispatch_failed'
  if (normalized.includes('run_lifecycle_reconciliation_stalled')) return 'run_lifecycle_reconciliation_stalled'
  if (normalized.includes('run_lifecycle_reconciliation_failed')) return 'run_lifecycle_reconciliation_failed'
  if (normalized.includes('analytics_change_query_failed')) return 'analytics_change_query_failed'
  if (normalized.includes('analytics_change_query_schema_mismatch')) return 'analytics_change_query_schema_mismatch'
  if (normalized.includes('cdr_audit_detected_gaps')) return 'cdr_audit_detected_gaps'
  if (normalized === 'site_health_attention' || normalized.includes('site_health_attention')) return 'site_health_diagnostics'
  return DEFAULT_ISSUE.code
}

function mapIssue(code: string): ActionableIssue {
  return ACTIONABLE_MAP[code] || DEFAULT_ISSUE
}

export function toActionableIssueSummaries(rows: Array<Record<string, unknown>>): ActionableIssueSummary[] {
  const grouped = new Map<string, ActionableIssueSummary>()

  for (const row of rows) {
    const codeRaw = String(row.code ?? '').trim()
    const message = String(row.message ?? '')
    const code = codeRaw || inferCodeFromMessage(message)
    const mapped = mapIssue(code)
    const ts = row.ts == null ? null : String(row.ts)
    const source = row.source == null ? null : String(row.source)

    const existing = grouped.get(mapped.code)
    if (!existing) {
      grouped.set(mapped.code, {
        ...mapped,
        count: 1,
        latest_ts: ts,
        latest_source: source,
        latest_message: message || null,
      })
      continue
    }

    existing.count += 1
    if (ts && (!existing.latest_ts || ts > existing.latest_ts)) {
      existing.latest_ts = ts
      existing.latest_source = source
      existing.latest_message = message || null
    }
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (!a.latest_ts && !b.latest_ts) return b.count - a.count
    if (!a.latest_ts) return 1
    if (!b.latest_ts) return -1
    if (a.latest_ts === b.latest_ts) return b.count - a.count
    return a.latest_ts > b.latest_ts ? -1 : 1
  })
}
