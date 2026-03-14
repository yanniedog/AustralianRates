import type { AdminDownloadArtifactRow, AdminDownloadJobRow } from '../db/admin-download-jobs'
import { gzipDecompressToText } from '../utils/compression'
import type { AdminDownloadEnv } from './admin-download-artifact-writer'
import {
  databaseDumpPartKind,
  databaseDumpPartOffset,
  databaseDumpPartTableName,
  fullDatabaseDumpFileName,
  hasSqlDumpArtifacts,
  sortDatabaseDumpArtifactsForBundle,
} from './admin-download-dump'
import { countTableRows, listDatabaseObjectSnapshot } from './admin-download-schema'

type HeaderObjects = {
  tables: string[]
  views: string[]
  triggers: string[]
}

export type DatabaseDumpRestoreTableAnalysis = {
  table_name: string
  schema_present: boolean
  data_part_count: number
  dump_row_count: number
  current_row_count: number | null
  contiguous: boolean
  issues: string[]
}

export type DatabaseDumpRestoreAnalysis = {
  job_id: string
  dump_file_name: string
  ready: boolean
  requires_force: boolean
  warnings: string[]
  errors: string[]
  source: {
    part_count: number
    total_bytes: number
    total_rows: number
    tables: DatabaseDumpRestoreTableAnalysis[]
    views: string[]
    triggers: string[]
    missing_required_parts: string[]
    missing_storage_parts: string[]
  }
  target: {
    table_count: number
    total_rows: number
    missing_tables: string[]
    extra_tables: string[]
    extra_views: string[]
    extra_triggers: string[]
    running_runs: number | null
    active_download_jobs: number | null
  }
  impact: {
    rows_to_restore: number
    rows_to_remove: number
    extra_tables_to_drop: number
    extra_views_to_drop: number
    extra_triggers_to_drop: number
  }
}

function decodeSqlIdentifier(value: string): string {
  const trimmed = String(value || '').trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"')
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1)
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1)
  return trimmed
}

function dropNames(sql: string, kind: 'TABLE' | 'VIEW' | 'TRIGGER'): string[] {
  const names: string[] = []
  const re = new RegExp(
    `DROP\\s+${kind}\\s+IF\\s+EXISTS\\s+((?:\"(?:[^\"]|\"\")+\")|(?:\\[[^\\]]+\\])|(?:\`[^\`]+\`)|(?:[A-Za-z0-9_-]+))\\s*;`,
    'gi',
  )
  let match = re.exec(sql)
  while (match) {
    names.push(decodeSqlIdentifier(match[1]))
    match = re.exec(sql)
  }
  return Array.from(new Set(names)).sort((left, right) => left.localeCompare(right))
}

export function parseDatabaseDumpHeaderObjects(sql: string): HeaderObjects {
  return {
    tables: dropNames(sql, 'TABLE'),
    views: dropNames(sql, 'VIEW'),
    triggers: dropNames(sql, 'TRIGGER'),
  }
}

function requiredDumpParts(artifacts: AdminDownloadArtifactRow[]): string[] {
  const counts = new Map<string, number>()
  for (const artifact of artifacts) {
    const kind = databaseDumpPartKind(artifact.file_name)
    if (!kind || kind === 'schema' || kind === 'data') continue
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return ['header', 'indexes', 'triggers', 'views', 'footer'].filter((kind) => (counts.get(kind) ?? 0) !== 1)
}

export function summarizeDatabaseDumpTables(artifacts: AdminDownloadArtifactRow[], sourceTables: string[]): DatabaseDumpRestoreTableAnalysis[] {
  return sourceTables.map((tableName) => {
    const schemaPresent = artifacts.some(
      (artifact) => artifact.artifact_kind === 'main' && databaseDumpPartKind(artifact.file_name) === 'schema' && databaseDumpPartTableName(artifact.file_name) === tableName,
    )
    const dataParts = artifacts
      .filter(
        (artifact) => artifact.artifact_kind === 'main' && databaseDumpPartKind(artifact.file_name) === 'data' && databaseDumpPartTableName(artifact.file_name) === tableName,
      )
      .sort((left, right) => (databaseDumpPartOffset(left.file_name) ?? 0) - (databaseDumpPartOffset(right.file_name) ?? 0))
    const issues: string[] = []
    let contiguous = true
    let expectedStart = 0
    let dumpRowCount = 0
    for (const artifact of dataParts) {
      const start = Math.max(0, Number(artifact.cursor_start ?? databaseDumpPartOffset(artifact.file_name) ?? 0))
      const end = Math.max(start, Number(artifact.cursor_end ?? start + Number(artifact.row_count ?? 0)))
      const rows = Math.max(0, Number(artifact.row_count ?? end - start))
      if (start !== expectedStart) {
        contiguous = false
        issues.push(`Expected data offset ${expectedStart} but found ${start}.`)
      }
      if (end - start !== rows) {
        issues.push(`Part ${artifact.file_name} metadata row_count does not match cursor range.`)
      }
      expectedStart = end
      dumpRowCount += rows
    }
    if (!schemaPresent && dataParts.length > 0) issues.push('Table data parts exist but schema part is missing.')
    return {
      table_name: tableName,
      schema_present: schemaPresent,
      data_part_count: dataParts.length,
      dump_row_count: dumpRowCount,
      current_row_count: null,
      contiguous,
      issues,
    }
  })
}

async function countScalar(db: D1Database, sql: string, binds: unknown[] = []): Promise<number | null> {
  try {
    const result = await db.prepare(sql).bind(...binds).first<{ n: number }>()
    return Math.max(0, Number(result?.n ?? 0))
  } catch {
    return null
  }
}

async function readArtifactSql(bucket: R2Bucket, artifact: AdminDownloadArtifactRow): Promise<string> {
  const object = await bucket.get(artifact.r2_key)
  if (!object) throw new Error(`Stored dump part is missing: ${artifact.file_name}`)
  return gzipDecompressToText(await object.arrayBuffer())
}

export async function analyzeDatabaseDumpRestore(
  env: Pick<AdminDownloadEnv, 'DB' | 'RAW_BUCKET'>,
  job: AdminDownloadJobRow,
  artifacts: AdminDownloadArtifactRow[],
): Promise<DatabaseDumpRestoreAnalysis> {
  const warnings: string[] = []
  const errors: string[] = []
  const mainArtifacts = sortDatabaseDumpArtifactsForBundle(
    artifacts.filter((artifact) => artifact.artifact_kind === 'main' && databaseDumpPartKind(artifact.file_name) !== null),
  )

  if (job.status !== 'completed') errors.push('Dump job must be completed before it can be restored.')
  if (!hasSqlDumpArtifacts(mainArtifacts)) errors.push('This job is not a restorable SQL dump.')

  const missingRequiredParts = requiredDumpParts(mainArtifacts)
  if (missingRequiredParts.length) errors.push(`Required dump parts are missing or duplicated: ${missingRequiredParts.join(', ')}`)

  const missingStorageParts: string[] = []
  for (const artifact of mainArtifacts) {
    const object = await env.RAW_BUCKET.head(artifact.r2_key)
    if (!object) missingStorageParts.push(artifact.file_name)
  }
  if (missingStorageParts.length) errors.push(`Stored dump parts are missing from R2: ${missingStorageParts.join(', ')}`)

  const headerArtifact = mainArtifacts.find((artifact) => databaseDumpPartKind(artifact.file_name) === 'header')
  const headerObjects =
    headerArtifact && !missingStorageParts.includes(headerArtifact.file_name)
      ? parseDatabaseDumpHeaderObjects(await readArtifactSql(env.RAW_BUCKET, headerArtifact))
      : { tables: [], views: [], triggers: [] }
  const sourceTables = Array.from(
    new Set(
      [
        ...headerObjects.tables,
        ...mainArtifacts
          .map((artifact) => databaseDumpPartTableName(artifact.file_name))
          .filter((tableName): tableName is string => !!tableName),
      ],
    ),
  ).sort((left, right) => left.localeCompare(right))
  const tables = summarizeDatabaseDumpTables(mainArtifacts, sourceTables)

  for (const table of tables) {
    if (!table.schema_present) errors.push(`Schema for table ${table.table_name} is missing from the dump.`)
    if (!table.contiguous) errors.push(`Data parts for table ${table.table_name} are incomplete or out of order.`)
    for (const issue of table.issues) warnings.push(`${table.table_name}: ${issue}`)
  }

  const current = await listDatabaseObjectSnapshot(env.DB)
  const currentRowCounts = new Map<string, number>()
  for (const tableName of current.tables) currentRowCounts.set(tableName, await countTableRows(env.DB, tableName))
  for (const table of tables) {
    table.current_row_count = currentRowCounts.has(table.table_name) ? currentRowCounts.get(table.table_name) ?? 0 : null
  }

  const missingTables = sourceTables.filter((tableName) => !current.tables.includes(tableName))
  const extraTables = current.tables.filter((tableName) => !sourceTables.includes(tableName)).sort((left, right) => left.localeCompare(right))
  const extraViews = current.views.filter((viewName) => !headerObjects.views.includes(viewName)).sort((left, right) => left.localeCompare(right))
  const extraTriggers = current.triggers.filter((triggerName) => !headerObjects.triggers.includes(triggerName)).sort((left, right) => left.localeCompare(right))
  const runningRuns = await countScalar(env.DB, `SELECT COUNT(*) AS n FROM run_reports WHERE status = 'running'`)
  const activeDownloadJobs = await countScalar(
    env.DB,
    `SELECT COUNT(*) AS n FROM admin_download_jobs WHERE status IN ('queued', 'processing') AND job_id <> ?1`,
    [job.job_id],
  )

  if ((runningRuns ?? 0) > 0) errors.push(`Restore is blocked while ${runningRuns} run report(s) are still running.`)
  if ((activeDownloadJobs ?? 0) > 0) errors.push(`Restore is blocked while ${activeDownloadJobs} other dump job(s) are queued or processing.`)
  if (missingTables.length) warnings.push(`Current database is missing ${missingTables.length} source table(s) that this restore would recreate.`)
  if (extraTables.length) warnings.push(`Current database has ${extraTables.length} extra table(s) that would be removed before restore.`)
  if (extraViews.length) warnings.push(`Current database has ${extraViews.length} extra view(s) that would be removed before restore.`)
  if (extraTriggers.length) warnings.push(`Current database has ${extraTriggers.length} extra trigger(s) that would be removed before restore.`)

  let rowsToRestore = 0
  let rowsToRemove = 0
  let sourceTotalRows = 0
  for (const table of tables) {
    sourceTotalRows += table.dump_row_count
    if (table.current_row_count == null) {
      rowsToRestore += table.dump_row_count
      continue
    }
    if (table.dump_row_count > table.current_row_count) rowsToRestore += table.dump_row_count - table.current_row_count
    if (table.current_row_count > table.dump_row_count) rowsToRemove += table.current_row_count - table.dump_row_count
  }
  for (const tableName of extraTables) rowsToRemove += currentRowCounts.get(tableName) ?? 0
  if (rowsToRestore > 0) warnings.push(`Restore would rehydrate at least ${rowsToRestore} row(s) that are currently missing.`)
  if (rowsToRemove > 0) warnings.push(`Restore would remove at least ${rowsToRemove} obsolete or corrupted row(s).`)

  return {
    job_id: job.job_id,
    dump_file_name: fullDatabaseDumpFileName(job),
    ready: errors.length === 0,
    requires_force: warnings.length > 0,
    warnings,
    errors,
    source: {
      part_count: mainArtifacts.length,
      total_bytes: mainArtifacts.reduce((sum, artifact) => sum + Math.max(0, Number(artifact.byte_size ?? 0)), 0),
      total_rows: sourceTotalRows,
      tables,
      views: headerObjects.views,
      triggers: headerObjects.triggers,
      missing_required_parts: missingRequiredParts,
      missing_storage_parts: missingStorageParts,
    },
    target: {
      table_count: current.tables.length,
      total_rows: Array.from(currentRowCounts.values()).reduce((sum, value) => sum + value, 0),
      missing_tables: missingTables,
      extra_tables: extraTables,
      extra_views: extraViews,
      extra_triggers: extraTriggers,
      running_runs: runningRuns,
      active_download_jobs: activeDownloadJobs,
    },
    impact: {
      rows_to_restore: rowsToRestore,
      rows_to_remove: rowsToRemove,
      extra_tables_to_drop: extraTables.length,
      extra_views_to_drop: extraViews.length,
      extra_triggers_to_drop: extraTriggers.length,
    },
  }
}
