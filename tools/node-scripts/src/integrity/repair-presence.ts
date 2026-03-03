import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hasRemoteFlag, looksLikeD1BindingName } from './repair-preview'

const SHADOW_EXPECTED_TABLE = 'repair_shadow_presence_expected'
const SHADOW_MISSING_TABLE = 'repair_shadow_presence_missing'
const SHADOW_EXTRA_TABLE = 'repair_shadow_presence_extra'
const SHADOW_EXTRA_SAFE_DELETE_TABLE = 'repair_shadow_presence_extra_safe_delete'

export type PresenceCanonicalSource = 'product_catalog' | 'historical_fallback'

export type RepairPresenceConfig = {
  dbPath: string
  apply: boolean
  deleteSafeExtras: boolean
}

type PresenceKey = {
  section: string
  bank_name: string
  product_id: string
}

type PresenceDiffRow = PresenceKey & {
  is_removed?: number
  removed_at?: string | null
  last_seen_collection_date?: string | null
  last_seen_at?: string | null
  last_seen_run_id?: string | null
}

type PresenceCounts = {
  expected_rows: number
  existing_rows: number
  missing_rows: number
  extra_rows: number
  safe_delete_rows: number
}

type PresenceReport = {
  ok: true
  mode: 'dry_run' | 'apply_local'
  canonical_source: PresenceCanonicalSource
  db_path: string
  generated_at: string
  shadow_tables?: {
    expected: string
    missing: string
    extra: string
    extra_safe_delete: string
  }
  before: {
    counts: PresenceCounts
    hashes: Record<string, string>
    samples: {
      missing: PresenceDiffRow[]
      extra: PresenceDiffRow[]
      safe_delete_extra: PresenceDiffRow[]
    }
  }
  after: {
    counts: PresenceCounts
    hashes: Record<string, string>
    projected: boolean
  }
  apply_actions: {
    delete_safe_extras_enabled: boolean
    inserted_missing_rows: number
    deleted_extra_rows: number
  }
}

const FORBIDDEN_SQL_TOKENS = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA)\b/i

function asSqliteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readCount(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined
  if (!row) return 0
  const first = Object.values(row)[0]
  return asSqliteNumber(first)
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1`)
    .get(tableName) as Record<string, unknown> | undefined
  return Boolean(row)
}

function ensureLocalSqlitePath(dbPathInput: string): string {
  if (looksLikeD1BindingName(dbPathInput)) {
    throw new Error(`Refusing repair-presence execution: "${dbPathInput}" looks like a D1 binding name.`)
  }

  const dbPath = path.resolve(dbPathInput)
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Local SQLite file not found: ${dbPath}`)
  }
  if (!fs.statSync(dbPath).isFile()) {
    throw new Error(`Path is not a file: ${dbPath}`)
  }
  return dbPath
}

export function parseRepairPresenceConfig(args: string[]): RepairPresenceConfig {
  if (hasRemoteFlag(args)) {
    throw new Error('Refusing repair-presence execution: --remote is not allowed for offline tooling.')
  }

  let apply = false
  let deleteSafeExtras = true
  const positional: string[] = []

  for (const arg of args) {
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--keep-extra') {
      deleteSafeExtras = false
      continue
    }
    if (arg.startsWith('-')) continue
    positional.push(arg)
  }

  const dbPathInput = positional[0]
  if (!dbPathInput) {
    throw new Error('Usage: repair-presence.ts <local-sqlite-db-path> [--apply] [--keep-extra]')
  }

  return {
    dbPath: ensureLocalSqlitePath(dbPathInput),
    apply,
    deleteSafeExtras,
  }
}

function normalizeDatasetKind(value: string): string {
  if (value === 'home_loans' || value === 'savings' || value === 'term_deposits') return value
  return 'home_loans'
}

function escapeSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function historicalProductsUnionSql(sectionFilter?: string): string {
  const maybeWhere = sectionFilter
    ? ` WHERE section = ${escapeSqlLiteral(normalizeDatasetKind(sectionFilter))}`
    : ''

  return `
SELECT section, bank_name, product_id
FROM (
  SELECT 'home_loans' AS section, bank_name, product_id
  FROM historical_loan_rates
  GROUP BY bank_name, product_id
  UNION
  SELECT 'savings' AS section, bank_name, product_id
  FROM historical_savings_rates
  GROUP BY bank_name, product_id
  UNION
  SELECT 'term_deposits' AS section, bank_name, product_id
  FROM historical_term_deposit_rates
  GROUP BY bank_name, product_id
) historical_products${maybeWhere}
`
}

function expectedPresenceSelectSql(source: PresenceCanonicalSource): string {
  if (source === 'product_catalog') {
    return `
SELECT
  dataset_kind AS section,
  bank_name,
  product_id,
  COALESCE(is_removed, 0) AS is_removed,
  removed_at,
  last_seen_collection_date,
  COALESCE(last_seen_at, CURRENT_TIMESTAMP) AS last_seen_at,
  last_successful_run_id AS last_seen_run_id
FROM product_catalog
`
  }

  return `
WITH unioned AS (
  SELECT
    'home_loans' AS section,
    bank_name,
    product_id,
    MAX(collection_date) AS last_seen_collection_date,
    MAX(COALESCE(parsed_at, collection_date || 'T00:00:00Z')) AS last_seen_at,
    MAX(COALESCE(run_id, '')) AS last_seen_run_id
  FROM historical_loan_rates
  GROUP BY bank_name, product_id
  UNION ALL
  SELECT
    'savings' AS section,
    bank_name,
    product_id,
    MAX(collection_date) AS last_seen_collection_date,
    MAX(COALESCE(parsed_at, collection_date || 'T00:00:00Z')) AS last_seen_at,
    MAX(COALESCE(run_id, '')) AS last_seen_run_id
  FROM historical_savings_rates
  GROUP BY bank_name, product_id
  UNION ALL
  SELECT
    'term_deposits' AS section,
    bank_name,
    product_id,
    MAX(collection_date) AS last_seen_collection_date,
    MAX(COALESCE(parsed_at, collection_date || 'T00:00:00Z')) AS last_seen_at,
    MAX(COALESCE(run_id, '')) AS last_seen_run_id
  FROM historical_term_deposit_rates
  GROUP BY bank_name, product_id
)
SELECT
  section,
  bank_name,
  product_id,
  0 AS is_removed,
  NULL AS removed_at,
  last_seen_collection_date,
  COALESCE(last_seen_at, CURRENT_TIMESTAMP) AS last_seen_at,
  NULLIF(last_seen_run_id, '') AS last_seen_run_id
FROM unioned
`
}

function diffWithCteSql(source: PresenceCanonicalSource, selector: string): string {
  const expectedSql = expectedPresenceSelectSql(source)
  const historicalProductsSql = historicalProductsUnionSql()
  return `
WITH expected AS (
  ${expectedSql}
),
missing AS (
  SELECT e.*
  FROM expected e
  LEFT JOIN product_presence_status p
    ON p.section = e.section
   AND p.bank_name = e.bank_name
   AND p.product_id = e.product_id
  WHERE p.product_id IS NULL
),
extra AS (
  SELECT p.*
  FROM product_presence_status p
  LEFT JOIN expected e
    ON e.section = p.section
   AND e.bank_name = p.bank_name
   AND e.product_id = p.product_id
  WHERE e.product_id IS NULL
),
historical_products AS (
  ${historicalProductsSql}
),
safe_delete_extra AS (
  SELECT x.*
  FROM extra x
  LEFT JOIN historical_products h
    ON h.section = x.section
   AND h.bank_name = x.bank_name
   AND h.product_id = x.product_id
  WHERE h.product_id IS NULL
)
${selector}
`
}

function validateReadOnlySql(sql: string, context: string): void {
  const normalized = sql.replace(/\s+/g, ' ').trim()
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error(`${context} must start with SELECT or WITH`)
  }
  if (FORBIDDEN_SQL_TOKENS.test(normalized)) {
    throw new Error(`${context} must be read-only`)
  }
}

export function buildRepairPresencePreviewSqls(source: PresenceCanonicalSource): Record<string, string> {
  const sqls = {
    expected_set: expectedPresenceSelectSql(source),
    counts: diffWithCteSql(
      source,
      `
SELECT
  (SELECT COUNT(*) FROM expected) AS expected_rows,
  (SELECT COUNT(*) FROM product_presence_status) AS existing_rows,
  (SELECT COUNT(*) FROM missing) AS missing_rows,
  (SELECT COUNT(*) FROM extra) AS extra_rows,
  (SELECT COUNT(*) FROM safe_delete_extra) AS safe_delete_rows
`,
    ),
    missing_sample: diffWithCteSql(
      source,
      `
SELECT section, bank_name, product_id, is_removed, removed_at, last_seen_collection_date, last_seen_at, last_seen_run_id
FROM missing
ORDER BY section, bank_name, product_id
LIMIT 50
`,
    ),
    extra_sample: diffWithCteSql(
      source,
      `
SELECT section, bank_name, product_id, is_removed, removed_at, last_seen_collection_date, last_seen_at, last_seen_run_id
FROM extra
ORDER BY section, bank_name, product_id
LIMIT 50
`,
    ),
    safe_delete_sample: diffWithCteSql(
      source,
      `
SELECT section, bank_name, product_id, is_removed, removed_at, last_seen_collection_date, last_seen_at, last_seen_run_id
FROM safe_delete_extra
ORDER BY section, bank_name, product_id
LIMIT 50
`,
    ),
    missing_full: diffWithCteSql(
      source,
      `
SELECT section, bank_name, product_id
FROM missing
ORDER BY section, bank_name, product_id
`,
    ),
    extra_full: diffWithCteSql(
      source,
      `
SELECT section, bank_name, product_id
FROM extra
ORDER BY section, bank_name, product_id
`,
    ),
  }

  for (const [name, sql] of Object.entries(sqls)) {
    validateReadOnlySql(sql, `repair-presence preview SQL (${name})`)
  }

  return sqls
}

function selectRows<T extends Record<string, unknown>>(db: DatabaseSync, sql: string): T[] {
  return db.prepare(sql).all() as T[]
}

function toDiffHash(rows: PresenceKey[]): string {
  const stable = rows
    .map((row) => ({
      section: String(row.section),
      bank_name: String(row.bank_name),
      product_id: String(row.product_id),
    }))
    .sort((a, b) => {
      const ak = `${a.section}\u0000${a.bank_name}\u0000${a.product_id}`
      const bk = `${b.section}\u0000${b.bank_name}\u0000${b.product_id}`
      return ak.localeCompare(bk)
    })

  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function combineKeys(missing: PresenceKey[], extra: PresenceKey[]): PresenceKey[] {
  return [...missing.map((row) => ({ ...row })), ...extra.map((row) => ({ ...row }))]
}

function computeDiffHashes(missing: PresenceKey[], extra: PresenceKey[]): Record<string, string> {
  return {
    missing_sha256: toDiffHash(missing),
    extra_sha256: toDiffHash(extra),
    combined_sha256: toDiffHash(combineKeys(missing, extra)),
  }
}

function selectCounts(db: DatabaseSync, source: PresenceCanonicalSource): PresenceCounts {
  const sqls = buildRepairPresencePreviewSqls(source)
  const row = db.prepare(sqls.counts).get() as Record<string, unknown> | undefined
  return {
    expected_rows: asSqliteNumber(row?.expected_rows),
    existing_rows: asSqliteNumber(row?.existing_rows),
    missing_rows: asSqliteNumber(row?.missing_rows),
    extra_rows: asSqliteNumber(row?.extra_rows),
    safe_delete_rows: asSqliteNumber(row?.safe_delete_rows),
  }
}

function selectSamples(db: DatabaseSync, source: PresenceCanonicalSource): {
  missing: PresenceDiffRow[]
  extra: PresenceDiffRow[]
  safeDeleteExtra: PresenceDiffRow[]
} {
  const sqls = buildRepairPresencePreviewSqls(source)
  return {
    missing: selectRows<PresenceDiffRow>(db, sqls.missing_sample),
    extra: selectRows<PresenceDiffRow>(db, sqls.extra_sample),
    safeDeleteExtra: selectRows<PresenceDiffRow>(db, sqls.safe_delete_sample),
  }
}

function selectDiffKeys(db: DatabaseSync, source: PresenceCanonicalSource): {
  missing: PresenceKey[]
  extra: PresenceKey[]
} {
  const sqls = buildRepairPresencePreviewSqls(source)
  return {
    missing: selectRows<PresenceKey>(db, sqls.missing_full),
    extra: selectRows<PresenceKey>(db, sqls.extra_full),
  }
}

function resolveCanonicalSource(db: DatabaseSync): PresenceCanonicalSource {
  const hasCatalog = tableExists(db, 'product_catalog')
  if (hasCatalog) {
    const catalogRows = readCount(db, 'SELECT COUNT(*) FROM product_catalog')
    if (catalogRows > 0) return 'product_catalog'
  }

  const hasHistoricalTables =
    tableExists(db, 'historical_loan_rates') &&
    tableExists(db, 'historical_savings_rates') &&
    tableExists(db, 'historical_term_deposit_rates')

  if (!hasHistoricalTables) {
    if (!hasCatalog) {
      throw new Error('Required canonical source tables missing: product_catalog and historical_* tables are unavailable.')
    }
    return 'product_catalog'
  }

  return 'historical_fallback'
}

function ensureRequiredTables(db: DatabaseSync): void {
  if (!tableExists(db, 'product_presence_status')) {
    throw new Error('Required table missing: product_presence_status')
  }
}

function recreateShadowTables(db: DatabaseSync, source: PresenceCanonicalSource): void {
  const expectedSql = expectedPresenceSelectSql(source)
  const historicalSql = historicalProductsUnionSql()

  db.exec(`
DROP TABLE IF EXISTS ${SHADOW_EXPECTED_TABLE};
DROP TABLE IF EXISTS ${SHADOW_MISSING_TABLE};
DROP TABLE IF EXISTS ${SHADOW_EXTRA_TABLE};
DROP TABLE IF EXISTS ${SHADOW_EXTRA_SAFE_DELETE_TABLE};

CREATE TABLE ${SHADOW_EXPECTED_TABLE} AS
${expectedSql};

CREATE TABLE ${SHADOW_MISSING_TABLE} AS
SELECT e.*
FROM ${SHADOW_EXPECTED_TABLE} e
LEFT JOIN product_presence_status p
  ON p.section = e.section
 AND p.bank_name = e.bank_name
 AND p.product_id = e.product_id
WHERE p.product_id IS NULL;

CREATE TABLE ${SHADOW_EXTRA_TABLE} AS
SELECT p.*
FROM product_presence_status p
LEFT JOIN ${SHADOW_EXPECTED_TABLE} e
  ON e.section = p.section
 AND e.bank_name = p.bank_name
 AND e.product_id = p.product_id
WHERE e.product_id IS NULL;

CREATE TABLE ${SHADOW_EXTRA_SAFE_DELETE_TABLE} AS
WITH historical_products AS (
${historicalSql}
)
SELECT x.*
FROM ${SHADOW_EXTRA_TABLE} x
LEFT JOIN historical_products h
  ON h.section = x.section
 AND h.bank_name = x.bank_name
 AND h.product_id = x.product_id
WHERE h.product_id IS NULL;
  `)
}

function applyPresenceRepair(db: DatabaseSync, deleteSafeExtras: boolean): { inserted: number; deleted: number } {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
INSERT OR IGNORE INTO product_presence_status (
  section,
  bank_name,
  product_id,
  is_removed,
  removed_at,
  last_seen_collection_date,
  last_seen_at,
  last_seen_run_id
)
SELECT
  section,
  bank_name,
  product_id,
  COALESCE(is_removed, 0),
  removed_at,
  last_seen_collection_date,
  COALESCE(last_seen_at, CURRENT_TIMESTAMP),
  last_seen_run_id
FROM ${SHADOW_MISSING_TABLE};
`)

    const inserted = readCount(db, 'SELECT changes()')

    let deleted = 0
    if (deleteSafeExtras) {
      db.exec(`
DELETE FROM product_presence_status
WHERE EXISTS (
  SELECT 1
  FROM ${SHADOW_EXTRA_SAFE_DELETE_TABLE} s
  WHERE s.section = product_presence_status.section
    AND s.bank_name = product_presence_status.bank_name
    AND s.product_id = product_presence_status.product_id
);
`)
      deleted = readCount(db, 'SELECT changes()')
    }

    db.exec('COMMIT')
    return { inserted, deleted }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function runPresenceRepair(config: RepairPresenceConfig): PresenceReport {
  const db = new DatabaseSync(config.dbPath, {
    readOnly: !config.apply,
  })

  try {
    ensureRequiredTables(db)
    const canonicalSource = resolveCanonicalSource(db)

    const beforeCounts = selectCounts(db, canonicalSource)
    const beforeSamples = selectSamples(db, canonicalSource)
    const beforeDiffKeys = selectDiffKeys(db, canonicalSource)
    const beforeHashes = computeDiffHashes(beforeDiffKeys.missing, beforeDiffKeys.extra)

    let insertedMissingRows = 0
    let deletedExtraRows = 0
    let afterCounts = beforeCounts
    let afterHashes = beforeHashes
    let projected = true

    if (config.apply) {
      recreateShadowTables(db, canonicalSource)
      const applyResult = applyPresenceRepair(db, config.deleteSafeExtras)
      insertedMissingRows = applyResult.inserted
      deletedExtraRows = applyResult.deleted

      recreateShadowTables(db, canonicalSource)
      afterCounts = selectCounts(db, canonicalSource)
      const afterDiffKeys = selectDiffKeys(db, canonicalSource)
      afterHashes = computeDiffHashes(afterDiffKeys.missing, afterDiffKeys.extra)
      projected = false
    } else {
      const projectedExtraRows = config.deleteSafeExtras
        ? Math.max(0, beforeCounts.extra_rows - beforeCounts.safe_delete_rows)
        : beforeCounts.extra_rows

      afterCounts = {
        ...beforeCounts,
        missing_rows: 0,
        existing_rows: beforeCounts.existing_rows + beforeCounts.missing_rows - (beforeCounts.extra_rows - projectedExtraRows),
        extra_rows: projectedExtraRows,
      }
    }

    return {
      ok: true,
      mode: config.apply ? 'apply_local' : 'dry_run',
      canonical_source: canonicalSource,
      db_path: config.dbPath,
      generated_at: new Date().toISOString(),
      shadow_tables: config.apply
        ? {
            expected: SHADOW_EXPECTED_TABLE,
            missing: SHADOW_MISSING_TABLE,
            extra: SHADOW_EXTRA_TABLE,
            extra_safe_delete: SHADOW_EXTRA_SAFE_DELETE_TABLE,
          }
        : undefined,
      before: {
        counts: beforeCounts,
        hashes: beforeHashes,
        samples: {
          missing: beforeSamples.missing,
          extra: beforeSamples.extra,
          safe_delete_extra: beforeSamples.safeDeleteExtra,
        },
      },
      after: {
        counts: afterCounts,
        hashes: afterHashes,
        projected,
      },
      apply_actions: {
        delete_safe_extras_enabled: config.deleteSafeExtras,
        inserted_missing_rows: insertedMissingRows,
        deleted_extra_rows: deletedExtraRows,
      },
    }
  } finally {
    db.close()
  }
}

export function main(args: string[]): void {
  const config = parseRepairPresenceConfig(args)
  const report = runPresenceRepair(config)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${(error as Error)?.message || String(error)}\n`)
    process.exitCode = 1
  }
}
