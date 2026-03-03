import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hasRemoteFlag, looksLikeD1BindingName } from './repair-preview'
import { isReadOnlySql, startsWithSelectOrWith } from './runbook'

const SHADOW_ORPHANS_TABLE = 'repair_shadow_raw_linkage_orphans'
const SHADOW_ORPHAN_HASHES_TABLE = 'repair_shadow_raw_linkage_orphan_hashes'
const SHADOW_CANDIDATE_HASHES_TABLE = 'repair_shadow_raw_linkage_candidate_hashes'
const SHADOW_ENRICHED_TABLE = 'repair_shadow_raw_linkage_enriched'
const SHADOW_PLANNED_ACTIONS_TABLE = 'repair_shadow_raw_linkage_planned_actions'
const SHADOW_PLANNED_ACTIONS_BY_TYPE_TABLE = 'repair_shadow_raw_linkage_planned_actions_by_type'
const SHADOW_PLANNED_ACTIONS_BY_BUCKET_TABLE = 'repair_shadow_raw_linkage_planned_actions_by_bucket'

export type RawLinkagePreviewConfig = {
  dbPath: string
  apply: boolean
  simulateRepair: boolean
}

export type RawLinkageSampleRow = {
  id: number
  source_type: string | null
  source_url: string | null
  content_hash: string | null
  has_fetch_event: number | null
  source_url_pattern: string | null
  likely_cause: string | null
}

type RawLinkageCountsRow = {
  orphan_count: number | null
  orphan_hashes_count: number | null
  candidate_raw_objects_count: number | null
}

type RawLinkageClassificationRow = {
  missing_raw_object_row: number | null
  fetch_event_present: number | null
  fetch_event_missing: number | null
  legacy_wayback_html: number | null
  other_source: number | null
}

type BucketRow = {
  bucket: string | null
  n: number | null
}

type PlannedActionRow = {
  content_hash: string | null
  action_type: string | null
  reason_bucket: string | null
  source_type: string | null
  source_url_pattern: string | null
  has_fetch_event: number | null
  has_normalized_match: number | null
}

export type RawLinkageBucketCount = {
  bucket: string
  count: number
}

export type RawLinkagePreviewReport = {
  ok: true
  mode: 'apply_local_shadow' | 'dry_run' | 'simulate_repair_shadow'
  db_path: string
  generated_at: string
  orphan_count: number
  orphan_count_before: number
  orphan_hashes_count: number
  candidate_raw_objects_count: number
  planned_actions_by_type: RawLinkageBucketCount[]
  planned_actions_by_bucket: RawLinkageBucketCount[]
  classification: {
    missing_raw_object_row: number
    fetch_event_present: number
    fetch_event_missing: number
    legacy_wayback_html: number
    other_source: number
    by_source_type: RawLinkageBucketCount[]
    by_fetch_event_presence: RawLinkageBucketCount[]
    by_source_url_pattern: RawLinkageBucketCount[]
    by_likely_cause: RawLinkageBucketCount[]
  }
  sample_orphans: RawLinkageSampleRow[]
  deterministic_hashes: {
    orphan_hashes_sha256: string
    candidate_hashes_sha256: string
    sample_orphans_sha256: string
    source_type_buckets_sha256: string
    fetch_presence_buckets_sha256: string
    source_url_pattern_buckets_sha256: string
    likely_cause_buckets_sha256: string
    planned_actions_sha256: string
    planned_actions_by_type_sha256: string
    planned_actions_by_bucket_sha256: string
  }
  shadow_tables: {
    orphan_rows: string
    orphan_hashes: string
    candidate_hashes: string
    enriched_rows: string
    planned_actions: string | null
    planned_actions_by_type: string | null
    planned_actions_by_bucket: string | null
  } | null
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function validateReadOnlySql(sql: string, context: string): void {
  if (!startsWithSelectOrWith(sql) || !isReadOnlySql(sql)) {
    throw new Error(`${context} must be SELECT/WITH read-only SQL.`)
  }
}

function resolveLocalSqlitePath(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error('Usage: repair-raw-linkage.ts <local-sqlite-db-path> [--apply] [--simulate-repair]')
  }
  if (looksLikeD1BindingName(raw)) {
    throw new Error(`Refusing repair-raw-linkage execution: "${raw}" looks like a D1 binding name.`)
  }

  const resolved = path.resolve(raw)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Local SQLite file not found: ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`Path is not a file: ${resolved}`)
  }
  return resolved
}

export function parseRawLinkagePreviewConfig(args: string[]): RawLinkagePreviewConfig {
  if (hasRemoteFlag(args)) {
    throw new Error('Refusing repair-raw-linkage execution: --remote is not allowed for offline tooling.')
  }

  let apply = false
  let simulateRepair = false
  const positional: string[] = []
  for (const arg of args) {
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--simulate-repair') {
      simulateRepair = true
      continue
    }
    if (arg.startsWith('-')) continue
    positional.push(arg)
  }

  return {
    dbPath: resolveLocalSqlitePath(positional[0] || ''),
    apply,
    simulateRepair,
  }
}

function orphanRowsCteSql(): string {
  return `
WITH orphan_rows AS (
  SELECT rp.id, rp.source_type, rp.source_url, rp.content_hash, rp.fetched_at
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
),
orphan_hashes AS (
  SELECT DISTINCT content_hash
  FROM orphan_rows
  WHERE content_hash IS NOT NULL AND TRIM(content_hash) != ''
),
fetch_hashes AS (
  SELECT DISTINCT fe.content_hash
  FROM fetch_events fe
  WHERE fe.content_hash IS NOT NULL AND TRIM(fe.content_hash) != ''
),
duplicate_hashes AS (
  SELECT content_hash
  FROM orphan_rows
  WHERE content_hash IS NOT NULL AND TRIM(content_hash) != ''
  GROUP BY content_hash
  HAVING COUNT(*) > 1
),
candidate_hashes AS (
  SELECT oh.content_hash
  FROM orphan_hashes oh
  JOIN fetch_hashes fh
    ON fh.content_hash = oh.content_hash
),
enriched AS (
  SELECT
    o.id,
    o.source_type,
    o.source_url,
    o.content_hash,
    o.fetched_at,
    CASE WHEN fh.content_hash IS NULL THEN 0 ELSE 1 END AS has_fetch_event,
    CASE
      WHEN LOWER(COALESCE(o.source_url, '')) LIKE '%web.archive.org%' THEN 'wayback_url'
      WHEN LOWER(COALESCE(o.source_url, '')) LIKE '%consumerdatastandards%' THEN 'cdr_register_or_standard'
      WHEN LOWER(COALESCE(o.source_url, '')) LIKE '%/banking/products%' THEN 'cdr_banking_products'
      WHEN LOWER(COALESCE(o.source_url, '')) LIKE '%rba.gov.au%' THEN 'rba_source'
      ELSE 'other_url'
    END AS source_url_pattern,
    CASE
      WHEN LOWER(COALESCE(o.source_type, '')) = 'wayback_html' THEN 'legacy_wayback_html'
      WHEN dh.content_hash IS NOT NULL THEN 'likely_duplicate_payload_hash'
      WHEN fh.content_hash IS NULL THEN 'missing_fetch_event_metadata'
      WHEN fh.content_hash IS NOT NULL THEN 'likely_missing_raw_object_row'
      ELSE 'other_source'
    END AS likely_cause
  FROM orphan_rows o
  LEFT JOIN fetch_hashes fh
    ON fh.content_hash = o.content_hash
  LEFT JOIN duplicate_hashes dh
    ON dh.content_hash = o.content_hash
)
`
}

function simulationActionsCteSql(): string {
  return `
WITH orphan_rows AS (
  SELECT rp.id, rp.source_type, rp.source_url, rp.content_hash, rp.fetched_at
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
),
orphan_hashes AS (
  SELECT DISTINCT content_hash
  FROM orphan_rows
  WHERE content_hash IS NOT NULL AND TRIM(content_hash) != ''
),
hash_enriched AS (
  SELECT
    oh.content_hash,
    MAX(orw.source_type) AS source_type,
    MAX(orw.source_url) AS source_url,
    SUM(CASE WHEN LOWER(COALESCE(orw.source_type, '')) = 'wayback_html' THEN 1 ELSE 0 END) AS wayback_type_hits,
    SUM(CASE WHEN LOWER(COALESCE(orw.source_url, '')) LIKE '%web.archive.org%' THEN 1 ELSE 0 END) AS wayback_url_hits,
    COUNT(*) AS orphan_payload_rows
  FROM orphan_hashes oh
  JOIN orphan_rows orw
    ON orw.content_hash = oh.content_hash
  GROUP BY oh.content_hash
),
fetch_hashes AS (
  SELECT DISTINCT fe.content_hash
  FROM fetch_events fe
  WHERE fe.content_hash IS NOT NULL AND TRIM(fe.content_hash) != ''
),
normalized_object_hashes AS (
  SELECT LOWER(TRIM(ro.content_hash)) AS normalized_hash
  FROM raw_objects ro
  WHERE ro.content_hash IS NOT NULL AND TRIM(ro.content_hash) != ''
  GROUP BY LOWER(TRIM(ro.content_hash))
),
planned_actions AS (
  SELECT
    h.content_hash,
    h.source_type,
    h.source_url,
    h.orphan_payload_rows,
    CASE WHEN fh.content_hash IS NULL THEN 0 ELSE 1 END AS has_fetch_event,
    CASE WHEN noh.normalized_hash IS NULL THEN 0 ELSE 1 END AS has_normalized_match,
    CASE
      WHEN h.wayback_type_hits > 0 OR h.wayback_url_hits > 0 THEN 'SKIP_LEGACY'
      WHEN noh.normalized_hash IS NOT NULL THEN 'LINK_EXISTING'
      WHEN fh.content_hash IS NOT NULL THEN 'INSERT_RAW_OBJECT'
      ELSE 'SKIP_UNKNOWN'
    END AS action_type,
    CASE
      WHEN h.wayback_type_hits > 0 OR h.wayback_url_hits > 0 THEN 'legacy_wayback_html'
      WHEN noh.normalized_hash IS NOT NULL THEN 'normalized_hash_match_existing_object'
      WHEN fh.content_hash IS NOT NULL THEN 'fetch_event_present_missing_raw_object'
      WHEN h.source_type IS NULL OR TRIM(h.source_type) = '' THEN 'missing_source_type_and_fetch_event'
      ELSE 'missing_fetch_event_metadata'
    END AS reason_bucket,
    CASE
      WHEN LOWER(COALESCE(h.source_url, '')) LIKE '%web.archive.org%' THEN 'wayback_url'
      WHEN LOWER(COALESCE(h.source_url, '')) LIKE '%consumerdatastandards%' THEN 'cdr_register_or_standard'
      WHEN LOWER(COALESCE(h.source_url, '')) LIKE '%/banking/products%' THEN 'cdr_banking_products'
      WHEN LOWER(COALESCE(h.source_url, '')) LIKE '%rba.gov.au%' THEN 'rba_source'
      ELSE 'other_url'
    END AS source_url_pattern
  FROM hash_enriched h
  LEFT JOIN fetch_hashes fh
    ON fh.content_hash = h.content_hash
  LEFT JOIN normalized_object_hashes noh
    ON noh.normalized_hash = LOWER(TRIM(h.content_hash))
)
`
}

export function buildRawLinkagePreviewSql(): Record<string, string> {
  const cte = orphanRowsCteSql()
  const simulationCte = simulationActionsCteSql()
  const sql = {
    counts: `
${cte}
SELECT
  (SELECT COUNT(*) FROM orphan_rows) AS orphan_count,
  (SELECT COUNT(*) FROM orphan_hashes) AS orphan_hashes_count,
  (SELECT COUNT(*) FROM candidate_hashes) AS candidate_raw_objects_count
`,
    classification: `
${cte}
SELECT
  COUNT(*) AS missing_raw_object_row,
  SUM(CASE WHEN has_fetch_event = 1 THEN 1 ELSE 0 END) AS fetch_event_present,
  SUM(CASE WHEN has_fetch_event = 0 THEN 1 ELSE 0 END) AS fetch_event_missing,
  SUM(CASE WHEN LOWER(COALESCE(source_type, '')) = 'wayback_html' THEN 1 ELSE 0 END) AS legacy_wayback_html,
  SUM(CASE WHEN LOWER(COALESCE(source_type, '')) != 'wayback_html' THEN 1 ELSE 0 END) AS other_source
FROM enriched
`,
    by_source_type: `
${cte}
SELECT COALESCE(source_type, 'unknown') AS bucket, COUNT(*) AS n
FROM enriched
GROUP BY COALESCE(source_type, 'unknown')
ORDER BY n DESC, bucket ASC
`,
    by_fetch_event_presence: `
${cte}
SELECT
  CASE WHEN has_fetch_event = 1 THEN 'present' ELSE 'missing' END AS bucket,
  COUNT(*) AS n
FROM enriched
GROUP BY CASE WHEN has_fetch_event = 1 THEN 'present' ELSE 'missing' END
ORDER BY n DESC, bucket ASC
`,
    by_source_url_pattern: `
${cte}
SELECT source_url_pattern AS bucket, COUNT(*) AS n
FROM enriched
GROUP BY source_url_pattern
ORDER BY n DESC, bucket ASC
`,
    by_likely_cause: `
${cte}
SELECT likely_cause AS bucket, COUNT(*) AS n
FROM enriched
GROUP BY likely_cause
ORDER BY n DESC, bucket ASC
`,
    sample_orphans: `
${cte}
SELECT
  id,
  source_type,
  source_url,
  content_hash,
  has_fetch_event,
  source_url_pattern,
  likely_cause
FROM enriched
ORDER BY fetched_at DESC, id DESC
LIMIT 50
`,
    orphan_hashes_full: `
${cte}
SELECT content_hash
FROM orphan_hashes
ORDER BY content_hash ASC
`,
    candidate_hashes_full: `
${cte}
SELECT content_hash
FROM candidate_hashes
ORDER BY content_hash ASC
`,
    planned_actions: `
${simulationCte}
SELECT
  content_hash,
  action_type,
  reason_bucket,
  source_type,
  source_url_pattern,
  has_fetch_event,
  has_normalized_match
FROM planned_actions
ORDER BY content_hash ASC
`,
    planned_actions_by_type: `
${simulationCte}
SELECT action_type AS bucket, COUNT(*) AS n
FROM planned_actions
GROUP BY action_type
ORDER BY n DESC, bucket ASC
`,
    planned_actions_by_bucket: `
${simulationCte}
SELECT reason_bucket AS bucket, COUNT(*) AS n
FROM planned_actions
GROUP BY reason_bucket
ORDER BY n DESC, bucket ASC
`,
  }

  for (const [name, query] of Object.entries(sql)) {
    validateReadOnlySql(query, `repair-raw-linkage preview SQL (${name})`)
  }

  return sql
}

function selectRows<T extends Record<string, unknown>>(db: DatabaseSync, sql: string): T[] {
  return db.prepare(sql).all() as T[]
}

function stableHash(values: unknown[]): string {
  const normalized = values
    .map((value) => JSON.stringify(value))
    .sort((a, b) => a.localeCompare(b))
  return crypto.createHash('sha256').update(normalized.join('\n')).digest('hex')
}

function normalizeBucketRows(rows: BucketRow[]): RawLinkageBucketCount[] {
  return rows.map((row) => ({
    bucket: String(row.bucket || 'unknown'),
    count: Math.max(0, asNumber(row.n)),
  }))
}

function ensureRequiredTables(db: DatabaseSync): void {
  const required = ['raw_payloads', 'raw_objects', 'fetch_events']
  for (const table of required) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?1`)
      .get(table) as { n: number } | undefined
    if (asNumber(row?.n) === 0) {
      throw new Error(`Required table missing for raw linkage preview: ${table}`)
    }
  }
}

function createShadowTables(db: DatabaseSync): void {
  const cte = orphanRowsCteSql()
  db.exec(`
DROP TABLE IF EXISTS ${SHADOW_ORPHANS_TABLE};
DROP TABLE IF EXISTS ${SHADOW_ORPHAN_HASHES_TABLE};
DROP TABLE IF EXISTS ${SHADOW_CANDIDATE_HASHES_TABLE};
DROP TABLE IF EXISTS ${SHADOW_ENRICHED_TABLE};

CREATE TABLE ${SHADOW_ORPHANS_TABLE} AS
${cte}
SELECT id, source_type, source_url, content_hash, fetched_at
FROM orphan_rows;

CREATE TABLE ${SHADOW_ORPHAN_HASHES_TABLE} AS
${cte}
SELECT content_hash
FROM orphan_hashes;

CREATE TABLE ${SHADOW_CANDIDATE_HASHES_TABLE} AS
${cte}
SELECT content_hash
FROM candidate_hashes;

CREATE TABLE ${SHADOW_ENRICHED_TABLE} AS
${cte}
SELECT id, source_type, source_url, content_hash, fetched_at, has_fetch_event, source_url_pattern, likely_cause
FROM enriched;
`)
}

function createSimulationShadowTables(db: DatabaseSync): void {
  const cte = simulationActionsCteSql()
  db.exec(`
DROP TABLE IF EXISTS ${SHADOW_PLANNED_ACTIONS_TABLE};
DROP TABLE IF EXISTS ${SHADOW_PLANNED_ACTIONS_BY_TYPE_TABLE};
DROP TABLE IF EXISTS ${SHADOW_PLANNED_ACTIONS_BY_BUCKET_TABLE};

CREATE TABLE ${SHADOW_PLANNED_ACTIONS_TABLE} AS
${cte}
SELECT
  content_hash,
  action_type,
  reason_bucket,
  source_type,
  source_url,
  source_url_pattern,
  orphan_payload_rows,
  has_fetch_event,
  has_normalized_match
FROM planned_actions;

CREATE TABLE ${SHADOW_PLANNED_ACTIONS_BY_TYPE_TABLE} AS
SELECT
  action_type AS bucket,
  COUNT(*) AS n
FROM ${SHADOW_PLANNED_ACTIONS_TABLE}
GROUP BY action_type
ORDER BY n DESC, bucket ASC;

CREATE TABLE ${SHADOW_PLANNED_ACTIONS_BY_BUCKET_TABLE} AS
SELECT
  reason_bucket AS bucket,
  COUNT(*) AS n
FROM ${SHADOW_PLANNED_ACTIONS_TABLE}
GROUP BY reason_bucket
ORDER BY n DESC, bucket ASC;
`)
}

export function runRawLinkageRepairPreview(config: RawLinkagePreviewConfig): RawLinkagePreviewReport {
  const shouldWriteShadowTables = config.apply || config.simulateRepair
  const db = new DatabaseSync(config.dbPath, { readOnly: !shouldWriteShadowTables })
  try {
    ensureRequiredTables(db)
    const sql = buildRawLinkagePreviewSql()

    const counts = db.prepare(sql.counts).get() as RawLinkageCountsRow | undefined
    const classification = db.prepare(sql.classification).get() as RawLinkageClassificationRow | undefined
    const bySourceType = normalizeBucketRows(selectRows<BucketRow>(db, sql.by_source_type))
    const byFetchEventPresence = normalizeBucketRows(selectRows<BucketRow>(db, sql.by_fetch_event_presence))
    const bySourceUrlPattern = normalizeBucketRows(selectRows<BucketRow>(db, sql.by_source_url_pattern))
    const byLikelyCause = normalizeBucketRows(selectRows<BucketRow>(db, sql.by_likely_cause))
    const sampleOrphans = selectRows<RawLinkageSampleRow>(db, sql.sample_orphans)
    const orphanHashesRows = selectRows<{ content_hash: string }>(db, sql.orphan_hashes_full)
    const candidateHashesRows = selectRows<{ content_hash: string }>(db, sql.candidate_hashes_full)
    const plannedActions = selectRows<PlannedActionRow>(db, sql.planned_actions)
    const plannedActionsByType = normalizeBucketRows(selectRows<BucketRow>(db, sql.planned_actions_by_type))
    const plannedActionsByBucket = normalizeBucketRows(selectRows<BucketRow>(db, sql.planned_actions_by_bucket))

    if (config.apply || config.simulateRepair) {
      createShadowTables(db)
    }
    if (config.simulateRepair) {
      createSimulationShadowTables(db)
    }

    const orphanHashes = orphanHashesRows.map((row) => String(row.content_hash || ''))
    const candidateHashes = candidateHashesRows.map((row) => String(row.content_hash || ''))
    const sampleKeys = sampleOrphans.map((row) => ({
      id: row.id,
      source_type: row.source_type,
      content_hash: row.content_hash,
      likely_cause: row.likely_cause,
    }))
    const plannedActionKeys = plannedActions.map((row) => ({
      content_hash: row.content_hash,
      action_type: row.action_type,
      reason_bucket: row.reason_bucket,
      source_type: row.source_type,
      source_url_pattern: row.source_url_pattern,
      has_fetch_event: row.has_fetch_event,
      has_normalized_match: row.has_normalized_match,
    }))

    return {
      ok: true,
      mode: config.simulateRepair ? 'simulate_repair_shadow' : config.apply ? 'apply_local_shadow' : 'dry_run',
      db_path: config.dbPath,
      generated_at: new Date().toISOString(),
      orphan_count: Math.max(0, asNumber(counts?.orphan_count)),
      orphan_count_before: Math.max(0, asNumber(counts?.orphan_count)),
      orphan_hashes_count: Math.max(0, asNumber(counts?.orphan_hashes_count)),
      candidate_raw_objects_count: Math.max(0, asNumber(counts?.candidate_raw_objects_count)),
      planned_actions_by_type: plannedActionsByType,
      planned_actions_by_bucket: plannedActionsByBucket,
      classification: {
        missing_raw_object_row: Math.max(0, asNumber(classification?.missing_raw_object_row)),
        fetch_event_present: Math.max(0, asNumber(classification?.fetch_event_present)),
        fetch_event_missing: Math.max(0, asNumber(classification?.fetch_event_missing)),
        legacy_wayback_html: Math.max(0, asNumber(classification?.legacy_wayback_html)),
        other_source: Math.max(0, asNumber(classification?.other_source)),
        by_source_type: bySourceType,
        by_fetch_event_presence: byFetchEventPresence,
        by_source_url_pattern: bySourceUrlPattern,
        by_likely_cause: byLikelyCause,
      },
      sample_orphans: sampleOrphans,
      deterministic_hashes: {
        orphan_hashes_sha256: stableHash(orphanHashes),
        candidate_hashes_sha256: stableHash(candidateHashes),
        sample_orphans_sha256: stableHash(sampleKeys),
        source_type_buckets_sha256: stableHash(bySourceType),
        fetch_presence_buckets_sha256: stableHash(byFetchEventPresence),
        source_url_pattern_buckets_sha256: stableHash(bySourceUrlPattern),
        likely_cause_buckets_sha256: stableHash(byLikelyCause),
        planned_actions_sha256: stableHash(plannedActionKeys),
        planned_actions_by_type_sha256: stableHash(plannedActionsByType),
        planned_actions_by_bucket_sha256: stableHash(plannedActionsByBucket),
      },
      shadow_tables: shouldWriteShadowTables
        ? {
            orphan_rows: SHADOW_ORPHANS_TABLE,
            orphan_hashes: SHADOW_ORPHAN_HASHES_TABLE,
            candidate_hashes: SHADOW_CANDIDATE_HASHES_TABLE,
            enriched_rows: SHADOW_ENRICHED_TABLE,
            planned_actions: config.simulateRepair ? SHADOW_PLANNED_ACTIONS_TABLE : null,
            planned_actions_by_type: config.simulateRepair ? SHADOW_PLANNED_ACTIONS_BY_TYPE_TABLE : null,
            planned_actions_by_bucket: config.simulateRepair ? SHADOW_PLANNED_ACTIONS_BY_BUCKET_TABLE : null,
          }
        : null,
    }
  } finally {
    db.close()
  }
}

export function buildRawLinkageMarkdownSummary(report: RawLinkagePreviewReport): string {
  const lines: string[] = []
  lines.push('# Raw Linkage Preview Summary')
  lines.push('')
  lines.push(`- mode: ${report.mode}`)
  lines.push(`- db_path: ${report.db_path}`)
  lines.push(`- orphan_count: ${report.orphan_count}`)
  lines.push(`- orphan_hashes_count: ${report.orphan_hashes_count}`)
  lines.push(`- candidate_raw_objects_count: ${report.candidate_raw_objects_count}`)
  lines.push('')
  lines.push('## Likely Causes')
  for (const item of report.classification.by_likely_cause.slice(0, 10)) {
    lines.push(`- ${item.bucket}: ${item.count}`)
  }
  lines.push('')
  lines.push('## Source Types')
  for (const item of report.classification.by_source_type.slice(0, 10)) {
    lines.push(`- ${item.bucket}: ${item.count}`)
  }
  lines.push('')
  lines.push('## Planned Actions (Simulation)')
  for (const item of report.planned_actions_by_type.slice(0, 10)) {
    lines.push(`- ${item.bucket}: ${item.count}`)
  }
  lines.push('')
  lines.push('## Planned Reason Buckets')
  for (const item of report.planned_actions_by_bucket.slice(0, 10)) {
    lines.push(`- ${item.bucket}: ${item.count}`)
  }
  return `${lines.join('\n')}\n`
}

export function main(args: string[]): void {
  const config = parseRawLinkagePreviewConfig(args)
  const report = runRawLinkageRepairPreview(config)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${(error as Error)?.message || String(error)}\n`)
    process.exitCode = 1
  }
}
