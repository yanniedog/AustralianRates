import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type QueryResult = {
  ok: boolean
  rows: Array<Record<string, unknown>>
  error?: string
}

type RepairPreviewConfig = {
  dbPath: string
  apply: boolean
}

const KNOWN_D1_BINDINGS = new Set([
  'australianrates_api',
  'australianrates-archive-prod',
  'DB',
  'ARCHIVE_DB',
])

export function hasRemoteFlag(args: string[]): boolean {
  return args.some((arg) => arg === '--remote' || arg.startsWith('--remote='))
}

export function looksLikeD1BindingName(value: string): boolean {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  if (KNOWN_D1_BINDINGS.has(normalized)) return true
  if (/^d1:/i.test(normalized)) return true

  const hasPathSeparator = /[\\/]/.test(normalized)
  const hasDbExtension = /\.(db|sqlite|sqlite3)$/i.test(normalized)
  return !hasPathSeparator && !hasDbExtension && /^[a-zA-Z0-9_-]+$/.test(normalized)
}

export function parseRepairPreviewConfig(args: string[]): RepairPreviewConfig {
  if (hasRemoteFlag(args)) {
    throw new Error('Refusing repair-preview execution: --remote is not allowed for offline tooling.')
  }

  let apply = false
  const positional: string[] = []
  for (const arg of args) {
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg.startsWith('-')) continue
    positional.push(arg)
  }

  const dbPathInput = positional[0]
  if (!dbPathInput) {
    throw new Error('Usage: repair-preview.ts <local-sqlite-db-path> [--apply]')
  }
  if (looksLikeD1BindingName(dbPathInput)) {
    throw new Error(`Refusing repair-preview execution: "${dbPathInput}" looks like a D1 binding name.`)
  }

  const dbPath = path.resolve(dbPathInput)
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Local SQLite file not found: ${dbPath}`)
  }
  if (!fs.statSync(dbPath).isFile()) {
    throw new Error(`Path is not a file: ${dbPath}`)
  }

  return { dbPath, apply }
}

function queryRows(db: DatabaseSync, sql: string): QueryResult {
  try {
    const statement = db.prepare(sql)
    const rows = statement.all() as Array<Record<string, unknown>>
    return { ok: true, rows }
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: (error as Error)?.message || String(error),
    }
  }
}

function previewPresenceDiff(db: DatabaseSync): Record<string, QueryResult> {
  const summary = queryRows(
    db,
    `
WITH expected AS (
  SELECT dataset_kind AS section, bank_name, product_id, is_removed, last_seen_collection_date
  FROM product_catalog
),
missing AS (
  SELECT e.section, e.bank_name, e.product_id
  FROM expected e
  LEFT JOIN product_presence_status p
    ON p.section = e.section
   AND p.bank_name = e.bank_name
   AND p.product_id = e.product_id
  WHERE p.product_id IS NULL
),
extra AS (
  SELECT p.section, p.bank_name, p.product_id
  FROM product_presence_status p
  LEFT JOIN expected e
    ON e.section = p.section
   AND e.bank_name = p.bank_name
   AND e.product_id = p.product_id
  WHERE e.product_id IS NULL
),
mismatch AS (
  SELECT
    e.section,
    e.bank_name,
    e.product_id,
    e.is_removed AS expected_is_removed,
    p.is_removed AS actual_is_removed,
    e.last_seen_collection_date AS expected_last_seen_collection_date,
    p.last_seen_collection_date AS actual_last_seen_collection_date
  FROM expected e
  JOIN product_presence_status p
    ON p.section = e.section
   AND p.bank_name = e.bank_name
   AND p.product_id = e.product_id
  WHERE COALESCE(e.is_removed, 0) != COALESCE(p.is_removed, 0)
     OR COALESCE(e.last_seen_collection_date, '') != COALESCE(p.last_seen_collection_date, '')
)
SELECT
  (SELECT COUNT(*) FROM expected) AS expected_rows,
  (SELECT COUNT(*) FROM product_presence_status) AS existing_rows,
  (SELECT COUNT(*) FROM missing) AS missing_rows,
  (SELECT COUNT(*) FROM extra) AS extra_rows,
  (SELECT COUNT(*) FROM mismatch) AS mismatched_rows
    `,
  )

  const missingSample = queryRows(
    db,
    `
WITH expected AS (
  SELECT dataset_kind AS section, bank_name, product_id
  FROM product_catalog
)
SELECT e.section, e.bank_name, e.product_id
FROM expected e
LEFT JOIN product_presence_status p
  ON p.section = e.section
 AND p.bank_name = e.bank_name
 AND p.product_id = e.product_id
WHERE p.product_id IS NULL
ORDER BY e.section, e.bank_name, e.product_id
LIMIT 20
    `,
  )

  const extraSample = queryRows(
    db,
    `
WITH expected AS (
  SELECT dataset_kind AS section, bank_name, product_id
  FROM product_catalog
)
SELECT p.section, p.bank_name, p.product_id
FROM product_presence_status p
LEFT JOIN expected e
  ON e.section = p.section
 AND e.bank_name = p.bank_name
 AND e.product_id = p.product_id
WHERE e.product_id IS NULL
ORDER BY p.section, p.bank_name, p.product_id
LIMIT 20
    `,
  )

  return {
    summary,
    missing_sample: missingSample,
    extra_sample: extraSample,
  }
}

function previewRawObjectLinkage(db: DatabaseSync): Record<string, QueryResult> {
  const summary = queryRows(
    db,
    `
WITH orphan_payloads AS (
  SELECT rp.id, rp.content_hash
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
),
hash_metadata AS (
  SELECT
    op.content_hash,
    COUNT(fe.id) AS fetch_event_matches,
    MAX(COALESCE(fe.body_bytes, 0)) AS max_body_bytes,
    MAX(COALESCE(NULLIF(json_extract(fe.response_headers_json, '$.content-type'), ''), '')) AS content_type_guess
  FROM orphan_payloads op
  LEFT JOIN fetch_events fe
    ON fe.content_hash = op.content_hash
  GROUP BY op.content_hash
)
SELECT
  (SELECT COUNT(*) FROM orphan_payloads) AS orphan_payload_rows,
  (SELECT COUNT(*) FROM hash_metadata) AS orphan_hashes,
  (SELECT COUNT(*) FROM hash_metadata WHERE fetch_event_matches > 0 AND max_body_bytes > 0) AS candidate_hashes_with_fetch_metadata,
  (SELECT COUNT(*) FROM hash_metadata WHERE fetch_event_matches = 0) AS candidate_hashes_without_fetch_metadata
    `,
  )

  const sample = queryRows(
    db,
    `
WITH orphan_payloads AS (
  SELECT rp.id, rp.source_type, rp.source_url, rp.content_hash, rp.r2_key, rp.fetched_at
  FROM raw_payloads rp
  LEFT JOIN raw_objects ro
    ON ro.content_hash = rp.content_hash
  WHERE ro.content_hash IS NULL
),
hash_metadata AS (
  SELECT
    op.content_hash,
    COUNT(fe.id) AS fetch_event_matches,
    MAX(COALESCE(fe.body_bytes, 0)) AS max_body_bytes,
    MAX(COALESCE(NULLIF(json_extract(fe.response_headers_json, '$.content-type'), ''), '')) AS content_type_guess
  FROM orphan_payloads op
  LEFT JOIN fetch_events fe
    ON fe.content_hash = op.content_hash
  GROUP BY op.content_hash
)
SELECT
  op.id,
  op.source_type,
  op.fetched_at,
  op.source_url,
  op.content_hash,
  op.r2_key,
  hm.fetch_event_matches,
  hm.max_body_bytes,
  hm.content_type_guess
FROM orphan_payloads op
LEFT JOIN hash_metadata hm
  ON hm.content_hash = op.content_hash
ORDER BY op.fetched_at DESC
LIMIT 20
    `,
  )

  return {
    summary,
    sample,
  }
}

function previewRunsWithNoOutputs(db: DatabaseSync): Record<string, QueryResult> {
  const summary = queryRows(
    db,
    `
WITH run_stats AS (
  SELECT
    rr.run_id,
    rr.run_type,
    rr.status,
    rr.started_at,
    rr.finished_at,
    (SELECT COUNT(*) FROM fetch_events fe WHERE fe.run_id = rr.run_id) AS fetch_events_total,
    (SELECT COUNT(*) FROM fetch_events fe WHERE fe.run_id = rr.run_id AND fe.http_status BETWEEN 200 AND 399) AS fetch_events_success,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows,
    (SELECT COUNT(*) FROM ingest_anomalies ia WHERE ia.run_id = rr.run_id) AS anomaly_rows
  FROM run_reports rr
),
no_outputs AS (
  SELECT
    *,
    (home_rows + savings_rows + td_rows) AS total_rows
  FROM run_stats
  WHERE (home_rows + savings_rows + td_rows) = 0
),
classified AS (
  SELECT
    *,
    CASE
      WHEN fetch_events_total = 0 THEN 'no_fetch_events'
      WHEN fetch_events_success = 0 THEN 'all_fetch_failed'
      WHEN fetch_events_success > 0 AND anomaly_rows > 0 THEN 'fetch_success_rows_rejected'
      WHEN fetch_events_success > 0 THEN 'fetch_success_no_rows'
      ELSE 'unknown'
    END AS reason
  FROM no_outputs
)
SELECT reason, COUNT(*) AS run_count
FROM classified
GROUP BY reason
ORDER BY run_count DESC, reason ASC
    `,
  )

  const sample = queryRows(
    db,
    `
WITH run_stats AS (
  SELECT
    rr.run_id,
    rr.run_type,
    rr.status,
    rr.started_at,
    rr.finished_at,
    (SELECT COUNT(*) FROM fetch_events fe WHERE fe.run_id = rr.run_id) AS fetch_events_total,
    (SELECT COUNT(*) FROM fetch_events fe WHERE fe.run_id = rr.run_id AND fe.http_status BETWEEN 200 AND 399) AS fetch_events_success,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows,
    (SELECT COUNT(*) FROM ingest_anomalies ia WHERE ia.run_id = rr.run_id) AS anomaly_rows
  FROM run_reports rr
),
classified AS (
  SELECT
    *,
    CASE
      WHEN fetch_events_total = 0 THEN 'no_fetch_events'
      WHEN fetch_events_success = 0 THEN 'all_fetch_failed'
      WHEN fetch_events_success > 0 AND anomaly_rows > 0 THEN 'fetch_success_rows_rejected'
      WHEN fetch_events_success > 0 THEN 'fetch_success_no_rows'
      ELSE 'unknown'
    END AS reason
  FROM run_stats
  WHERE (home_rows + savings_rows + td_rows) = 0
)
SELECT
  run_id,
  run_type,
  status,
  started_at,
  finished_at,
  fetch_events_total,
  fetch_events_success,
  home_rows,
  savings_rows,
  td_rows,
  anomaly_rows,
  reason
FROM classified
ORDER BY started_at DESC
LIMIT 20
    `,
  )

  return {
    summary,
    sample,
  }
}

function applyShadowWrites(db: DatabaseSync): void {
  db.exec(`
DROP TABLE IF EXISTS repair_shadow_presence_expected;
CREATE TABLE repair_shadow_presence_expected AS
SELECT
  dataset_kind AS section,
  bank_name,
  product_id,
  is_removed,
  last_seen_collection_date,
  last_seen_at,
  last_successful_run_id
FROM product_catalog;

DROP TABLE IF EXISTS repair_shadow_orphan_raw_payloads;
CREATE TABLE repair_shadow_orphan_raw_payloads AS
SELECT rp.*
FROM raw_payloads rp
LEFT JOIN raw_objects ro
  ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL;

DROP TABLE IF EXISTS repair_shadow_runs_no_outputs;
CREATE TABLE repair_shadow_runs_no_outputs AS
WITH run_stats AS (
  SELECT
    rr.run_id,
    rr.run_type,
    rr.status,
    rr.started_at,
    rr.finished_at,
    (SELECT COUNT(*) FROM fetch_events fe WHERE fe.run_id = rr.run_id) AS fetch_events_total,
    (SELECT COUNT(*) FROM fetch_events fe WHERE fe.run_id = rr.run_id AND fe.http_status BETWEEN 200 AND 399) AS fetch_events_success,
    (SELECT COUNT(*) FROM historical_loan_rates hl WHERE hl.run_id = rr.run_id) AS home_rows,
    (SELECT COUNT(*) FROM historical_savings_rates hs WHERE hs.run_id = rr.run_id) AS savings_rows,
    (SELECT COUNT(*) FROM historical_term_deposit_rates ht WHERE ht.run_id = rr.run_id) AS td_rows,
    (SELECT COUNT(*) FROM ingest_anomalies ia WHERE ia.run_id = rr.run_id) AS anomaly_rows
  FROM run_reports rr
)
SELECT
  run_id,
  run_type,
  status,
  started_at,
  finished_at,
  fetch_events_total,
  fetch_events_success,
  home_rows,
  savings_rows,
  td_rows,
  anomaly_rows,
  CASE
    WHEN fetch_events_total = 0 THEN 'no_fetch_events'
    WHEN fetch_events_success = 0 THEN 'all_fetch_failed'
    WHEN fetch_events_success > 0 AND anomaly_rows > 0 THEN 'fetch_success_rows_rejected'
    WHEN fetch_events_success > 0 THEN 'fetch_success_no_rows'
    ELSE 'unknown'
  END AS reason
FROM run_stats
WHERE (home_rows + savings_rows + td_rows) = 0;
  `)
}

export function runRepairPreview(config: RepairPreviewConfig): Record<string, unknown> {
  const db = new DatabaseSync(config.dbPath, {
    readOnly: !config.apply,
  })

  try {
    const presence = previewPresenceDiff(db)
    const rawLinkage = previewRawObjectLinkage(db)
    const runsNoOutputs = previewRunsWithNoOutputs(db)

    if (config.apply) {
      applyShadowWrites(db)
    }

    return {
      ok: true,
      mode: config.apply ? 'apply_local_shadow' : 'dry_run',
      db_path: config.dbPath,
      generated_at: new Date().toISOString(),
      sections: {
        presence_rebuild_diff: presence,
        raw_payload_linkage_preview: rawLinkage,
        runs_with_no_outputs_classification: runsNoOutputs,
      },
    }
  } finally {
    db.close()
  }
}

export function main(args: string[]): void {
  const config = parseRepairPreviewConfig(args)
  const result = runRepairPreview(config)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${(error as Error)?.message || String(error)}\n`)
    process.exitCode = 1
  }
}
