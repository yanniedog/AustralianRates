type TargetDb = 'api' | 'archive'

export type IntegrityQuerySpec = {
  id: string
  title: string
  db: TargetDb
  sql: string
  sample: boolean
  bounded: boolean
  notes?: string
}

const API_DB_NAME = 'australianrates_api'
const ARCHIVE_DB_NAME = 'australianrates-archive-prod'

const FORBIDDEN_SQL_TOKENS = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

export function startsWithSelectOrWith(sql: string): boolean {
  return /^(SELECT|WITH)\b/i.test(normalizeSql(sql))
}

export function includesLimit20(sql: string): boolean {
  return /\bLIMIT\s+20\b/i.test(normalizeSql(sql))
}

export function isReadOnlySql(sql: string): boolean {
  const normalized = normalizeSql(sql)
  return startsWithSelectOrWith(normalized) && !FORBIDDEN_SQL_TOKENS.test(normalized)
}

function escapeForCommand(sql: string): string {
  return normalizeSql(sql).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function dbNameFor(target: TargetDb): string {
  return target === 'api' ? API_DB_NAME : ARCHIVE_DB_NAME
}

export function toWranglerCommand(spec: IntegrityQuerySpec): string {
  return `wrangler d1 execute ${dbNameFor(spec.db)} --remote --command "${escapeForCommand(spec.sql)}"`
}

export function buildIntegrityRunbookSpecs(): IntegrityQuerySpec[] {
  return [
    {
      id: 'api_orphan_presence_count',
      title: 'API DB: orphan product presence rows (count)',
      db: 'api',
      sample: false,
      bounded: false,
      sql: `
SELECT COUNT(*) AS orphan_presence_count
FROM product_presence_status p
LEFT JOIN product_catalog c
  ON c.dataset_kind = p.section
 AND c.bank_name = p.bank_name
 AND c.product_id = p.product_id
WHERE c.product_id IS NULL
      `,
    },
    {
      id: 'api_orphan_presence_sample',
      title: 'API DB: orphan product presence rows (sample)',
      db: 'api',
      sample: true,
      bounded: false,
      sql: `
SELECT p.section, p.bank_name, p.product_id, p.is_removed, p.last_seen_collection_date, p.last_seen_at
FROM product_presence_status p
LEFT JOIN product_catalog c
  ON c.dataset_kind = p.section
 AND c.bank_name = p.bank_name
 AND c.product_id = p.product_id
WHERE c.product_id IS NULL
ORDER BY p.last_seen_at DESC
LIMIT 20
      `,
    },
    {
      id: 'api_orphan_presence_count_90d',
      title: 'API DB: orphan product presence rows (last 90 days)',
      db: 'api',
      sample: false,
      bounded: true,
      sql: `
SELECT COUNT(*) AS orphan_presence_count_90d
FROM product_presence_status p
LEFT JOIN product_catalog c
  ON c.dataset_kind = p.section
 AND c.bank_name = p.bank_name
 AND c.product_id = p.product_id
WHERE c.product_id IS NULL
  AND p.last_seen_at >= datetime('now', '-90 days')
      `,
    },
    {
      id: 'api_orphan_raw_link_count',
      title: 'API DB: orphan raw payload -> raw_objects linkage (count)',
      db: 'api',
      sample: false,
      bounded: false,
      sql: `
SELECT COUNT(*) AS orphan_raw_link_count
FROM raw_payloads rp
LEFT JOIN raw_objects ro
  ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL
      `,
    },
    {
      id: 'api_orphan_raw_link_sample',
      title: 'API DB: orphan raw payload -> raw_objects linkage (sample)',
      db: 'api',
      sample: true,
      bounded: false,
      sql: `
SELECT rp.id, rp.source_type, rp.fetched_at, rp.source_url, rp.content_hash, rp.r2_key
FROM raw_payloads rp
LEFT JOIN raw_objects ro
  ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL
ORDER BY rp.fetched_at DESC
LIMIT 20
      `,
    },
    {
      id: 'api_orphan_raw_link_count_90d',
      title: 'API DB: orphan raw payload linkage (last 90 days)',
      db: 'api',
      sample: false,
      bounded: true,
      sql: `
SELECT COUNT(*) AS orphan_raw_link_count_90d
FROM raw_payloads rp
LEFT JOIN raw_objects ro
  ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL
  AND rp.fetched_at >= datetime('now', '-90 days')
      `,
    },
    {
      id: 'api_runs_no_outputs_count',
      title: 'API DB: runs with no outputs (count)',
      db: 'api',
      sample: false,
      bounded: false,
      sql: `
WITH run_outputs AS (
  SELECT
    rr.run_id,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
  FROM run_reports rr
)
SELECT COUNT(*) AS runs_with_no_outputs
FROM run_outputs
WHERE (home_rows + savings_rows + td_rows) = 0
      `,
    },
    {
      id: 'api_runs_no_outputs_sample',
      title: 'API DB: runs with no outputs (sample)',
      db: 'api',
      sample: true,
      bounded: false,
      sql: `
WITH run_outputs AS (
  SELECT
    rr.run_id,
    rr.run_type,
    rr.run_source,
    rr.status,
    rr.started_at,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
  FROM run_reports rr
)
SELECT run_id, run_type, run_source, status, started_at, home_rows, savings_rows, td_rows
FROM run_outputs
WHERE (home_rows + savings_rows + td_rows) = 0
ORDER BY started_at DESC
LIMIT 20
      `,
    },
    {
      id: 'api_runs_no_outputs_count_90d',
      title: 'API DB: runs with no outputs (last 90 days)',
      db: 'api',
      sample: false,
      bounded: true,
      sql: `
WITH run_outputs AS (
  SELECT
    rr.run_id,
    rr.started_at,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows
  FROM run_reports rr
  WHERE rr.started_at >= datetime('now', '-90 days')
)
SELECT COUNT(*) AS runs_with_no_outputs_90d
FROM run_outputs
WHERE (home_rows + savings_rows + td_rows) = 0
      `,
    },
    {
      id: 'api_freshness_global_vs_scheduled',
      title: 'API DB: latest != global max (freshness indicator, not corruption)',
      db: 'api',
      sample: false,
      bounded: false,
      notes: 'Indicator only: mismatch can be expected when manual/backfill data is newer than scheduled data.',
      sql: `
WITH dataset_latest AS (
  SELECT
    'home_loans' AS dataset,
    MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_loan_rates
  UNION ALL
  SELECT
    'savings' AS dataset,
    MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_savings_rates
  UNION ALL
  SELECT
    'term_deposits' AS dataset,
    MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_term_deposit_rates
)
SELECT
  dataset,
  global_latest,
  scheduled_latest,
  CASE
    WHEN global_latest IS NULL OR scheduled_latest IS NULL THEN NULL
    WHEN global_latest = scheduled_latest THEN 0
    ELSE 1
  END AS latest_global_mismatch
FROM dataset_latest
ORDER BY dataset
      `,
    },
    {
      id: 'api_freshness_mismatch_count',
      title: 'API DB: latest/global mismatch dataset count (indicator)',
      db: 'api',
      sample: false,
      bounded: false,
      notes: 'Indicator only: non-zero means scheduled freshness lag relative to global max.',
      sql: `
WITH dataset_latest AS (
  SELECT
    'home_loans' AS dataset,
    MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_loan_rates
  UNION ALL
  SELECT
    'savings' AS dataset,
    MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_savings_rates
  UNION ALL
  SELECT
    'term_deposits' AS dataset,
    MAX(collection_date) AS global_latest,
    MAX(CASE WHEN COALESCE(run_source, 'scheduled') = 'scheduled' THEN collection_date END) AS scheduled_latest
  FROM historical_term_deposit_rates
)
SELECT COUNT(*) AS freshness_mismatch_dataset_count
FROM dataset_latest
WHERE global_latest IS NOT NULL
  AND scheduled_latest IS NOT NULL
  AND global_latest != scheduled_latest
      `,
    },
    {
      id: 'archive_run_reports_status_count',
      title: 'Archive DB: run status distribution',
      db: 'archive',
      sample: false,
      bounded: false,
      sql: `
SELECT status, COUNT(*) AS n
FROM run_reports
GROUP BY status
ORDER BY n DESC, status ASC
      `,
    },
    {
      id: 'archive_terminal_without_finished_count',
      title: 'Archive DB: terminal runs missing finished_at (count)',
      db: 'archive',
      sample: false,
      bounded: false,
      sql: `
SELECT COUNT(*) AS terminal_without_finished_count
FROM run_reports
WHERE status IN ('completed', 'completed_with_warnings', 'partial', 'failed')
  AND (finished_at IS NULL OR TRIM(finished_at) = '')
      `,
    },
    {
      id: 'archive_terminal_without_finished_sample',
      title: 'Archive DB: terminal runs missing finished_at (sample)',
      db: 'archive',
      sample: true,
      bounded: false,
      sql: `
SELECT run_id, run_type, status, started_at, finished_at
FROM run_reports
WHERE status IN ('completed', 'completed_with_warnings', 'partial', 'failed')
  AND (finished_at IS NULL OR TRIM(finished_at) = '')
ORDER BY started_at DESC
LIMIT 20
      `,
    },
    {
      id: 'archive_recent_run_reports_30d',
      title: 'Archive DB: run status distribution (last 30 days)',
      db: 'archive',
      sample: false,
      bounded: true,
      sql: `
SELECT status, COUNT(*) AS n
FROM run_reports
WHERE started_at >= datetime('now', '-30 days')
GROUP BY status
ORDER BY n DESC, status ASC
      `,
    },
  ]
}

export function validateRunbookSpecs(specs: IntegrityQuerySpec[]): string[] {
  const failures: string[] = []
  for (const spec of specs) {
    if (!isReadOnlySql(spec.sql)) {
      failures.push(`${spec.id}: SQL must be read-only and begin with SELECT or WITH`)
    }
    if (spec.sample && !includesLimit20(spec.sql)) {
      failures.push(`${spec.id}: sample query must include LIMIT 20`)
    }
  }
  return failures
}

function printSection(title: string): void {
  process.stdout.write(`\n## ${title}\n`)
}

function printRunbook(specs: IntegrityQuerySpec[]): void {
  printSection('API DB (australianrates_api)')
  for (const spec of specs.filter((item) => item.db === 'api')) {
    process.stdout.write(`\n# ${spec.title}\n`)
    if (spec.notes) process.stdout.write(`# note: ${spec.notes}\n`)
    process.stdout.write(`${toWranglerCommand(spec)}\n`)
  }

  printSection('Archive DB (australianrates-archive-prod)')
  for (const spec of specs.filter((item) => item.db === 'archive')) {
    process.stdout.write(`\n# ${spec.title}\n`)
    if (spec.notes) process.stdout.write(`# note: ${spec.notes}\n`)
    process.stdout.write(`${toWranglerCommand(spec)}\n`)
  }
}

export function main(): void {
  const specs = buildIntegrityRunbookSpecs()
  const failures = validateRunbookSpecs(specs)
  if (failures.length > 0) {
    process.stderr.write('Integrity runbook validation failed:\n')
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`)
    }
    process.exitCode = 1
    return
  }
  printRunbook(specs)
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
