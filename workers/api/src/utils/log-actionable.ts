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
}

function inferCodeFromMessage(message: string): string {
  const normalized = String(message || '').toLowerCase()
  if (normalized.includes('queue_message_exhausted')) return 'queue_message_exhausted'
  if (normalized.includes('queue_message_failed')) return 'queue_message_failed'
  if (normalized.includes('upsert_failed')) return 'upsert_failed'
  if (normalized.includes('daily run') && normalized.includes('failed')) return 'daily_run_failed'
  if (normalized.includes('backfill run') && normalized.includes('failed')) return 'backfill_run_failed'
  if (normalized.includes('unknown cron expression')) return 'unknown_cron_expression'
  if (normalized.includes('app_config') && normalized.includes('unavailable')) return 'app_config_unavailable'
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
