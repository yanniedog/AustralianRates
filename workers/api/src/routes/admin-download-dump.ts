import type { AdminDownloadArtifactRow, AdminDownloadJobRow } from '../db/admin-download-jobs'

const INTERNAL_TABLE_PREFIXES = ['sqlite_', '_cf_']

export const DATABASE_DUMP_ROW_BATCH_SIZE = 1_000
export const DATABASE_DUMP_PARTS_PER_PASS = 3
export const ADMIN_DOWNLOAD_STALE_MS = 90_000

type DatabaseDumpPartKind = 'header' | 'schema' | 'data' | 'indexes' | 'triggers' | 'views' | 'footer'

const SCHEMA_FILE_RE = /^database-dump-schema-([A-Za-z0-9_-]+)\.sql\.gz$/i
const DATA_FILE_RE = /^database-dump-data-([A-Za-z0-9_-]+)-offset-(\d+)\.sql\.gz$/i

function sanitizeFileSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'table'
}

function compactTimestampToken(value: string): string {
  const iso = String(value || '').trim()
  if (!iso) return 'snapshot'
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function isDatabaseDumpInternalTable(tableName: string): boolean {
  const normalized = String(tableName || '').trim().toLowerCase()
  if (!normalized) return true
  return INTERNAL_TABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function isProtectedDatabaseDumpTableError(error: unknown): boolean {
  const message = (error as Error)?.message || String(error || '')
  return message.includes('SQLITE_AUTH') && message.includes('access to')
}

export function adminDownloadStaleBeforeIso(now = Date.now()): string {
  return new Date(now - ADMIN_DOWNLOAD_STALE_MS).toISOString()
}

export function fullDatabaseDumpFileName(job: Pick<AdminDownloadJobRow, 'requested_at'>): string {
  return `australianrates-database-full-${compactTimestampToken(job.requested_at)}.sql.gz`
}

export function databaseDumpHeaderFileName(): string {
  return 'database-dump-header.sql.gz'
}

export function databaseDumpSchemaFileName(tableName: string): string {
  return `database-dump-schema-${sanitizeFileSegment(tableName)}.sql.gz`
}

export function databaseDumpDataFileName(tableName: string, offset: number): string {
  return `database-dump-data-${sanitizeFileSegment(tableName)}-offset-${String(Math.max(0, Math.floor(offset))).padStart(8, '0')}.sql.gz`
}

export function databaseDumpIndexesFileName(): string {
  return 'database-dump-indexes.sql.gz'
}

export function databaseDumpTriggersFileName(): string {
  return 'database-dump-triggers.sql.gz'
}

export function databaseDumpViewsFileName(): string {
  return 'database-dump-views.sql.gz'
}

export function databaseDumpFooterFileName(): string {
  return 'database-dump-footer.sql.gz'
}

export function databaseDumpArtifactR2Key(jobId: string, fileName: string): string {
  return `admin-downloads/${jobId}/${fileName}`
}

export function databaseDumpPartKind(fileName: string): DatabaseDumpPartKind | null {
  const normalized = String(fileName || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === databaseDumpHeaderFileName()) return 'header'
  if (normalized === databaseDumpIndexesFileName()) return 'indexes'
  if (normalized === databaseDumpTriggersFileName()) return 'triggers'
  if (normalized === databaseDumpViewsFileName()) return 'views'
  if (normalized === databaseDumpFooterFileName()) return 'footer'
  if (SCHEMA_FILE_RE.test(normalized)) return 'schema'
  if (DATA_FILE_RE.test(normalized)) return 'data'
  return null
}

export function databaseDumpPartTableName(fileName: string): string | null {
  const schemaMatch = SCHEMA_FILE_RE.exec(String(fileName || '').trim())
  if (schemaMatch) return schemaMatch[1]
  const dataMatch = DATA_FILE_RE.exec(String(fileName || '').trim())
  return dataMatch ? dataMatch[1] : null
}

export function databaseDumpPartOffset(fileName: string): number | null {
  const match = DATA_FILE_RE.exec(String(fileName || '').trim())
  if (!match) return null
  const parsed = Number(match[2])
  return Number.isFinite(parsed) ? parsed : null
}

export function databaseDumpProgressByTable(artifacts: AdminDownloadArtifactRow[]): Map<string, number> {
  const progress = new Map<string, number>()
  for (const artifact of artifacts) {
    if (artifact.artifact_kind !== 'main') continue
    if (databaseDumpPartKind(artifact.file_name) !== 'data') continue
    const tableName = databaseDumpPartTableName(artifact.file_name)
    if (!tableName) continue
    const endOffset = Number(artifact.cursor_end ?? 0)
    if (!Number.isFinite(endOffset) || endOffset < 0) continue
    const current = progress.get(tableName) ?? 0
    if (endOffset > current) progress.set(tableName, endOffset)
  }
  return progress
}

export function isSqlDumpArtifact(artifact: Pick<AdminDownloadArtifactRow, 'file_name'>): boolean {
  return databaseDumpPartKind(artifact.file_name) !== null
}

export function hasSqlDumpArtifacts(artifacts: AdminDownloadArtifactRow[]): boolean {
  return artifacts.some((artifact) => isSqlDumpArtifact(artifact))
}

export function listDatabaseDumpArtifactTables(artifacts: AdminDownloadArtifactRow[]): string[] {
  return Array.from(
    new Set(
      artifacts
        .map((artifact) => databaseDumpPartTableName(artifact.file_name))
        .filter((tableName): tableName is string => !!tableName),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export function sortDatabaseDumpArtifactsForBundle(artifacts: AdminDownloadArtifactRow[]): AdminDownloadArtifactRow[] {
  const phaseOrder: Record<DatabaseDumpPartKind, number> = {
    header: 0,
    schema: 1,
    data: 2,
    indexes: 3,
    triggers: 4,
    views: 5,
    footer: 6,
  }

  return artifacts
    .filter((artifact) => artifact.artifact_kind === 'main' && databaseDumpPartKind(artifact.file_name) !== null)
    .sort((left, right) => {
      const leftKind = databaseDumpPartKind(left.file_name) as DatabaseDumpPartKind
      const rightKind = databaseDumpPartKind(right.file_name) as DatabaseDumpPartKind
      if (phaseOrder[leftKind] !== phaseOrder[rightKind]) return phaseOrder[leftKind] - phaseOrder[rightKind]

      const leftTable = databaseDumpPartTableName(left.file_name) ?? ''
      const rightTable = databaseDumpPartTableName(right.file_name) ?? ''
      const tableCompare = leftTable.localeCompare(rightTable)
      if (tableCompare !== 0) return tableCompare

      const leftOffset = databaseDumpPartOffset(left.file_name) ?? 0
      const rightOffset = databaseDumpPartOffset(right.file_name) ?? 0
      if (leftOffset !== rightOffset) return leftOffset - rightOffset

      return left.file_name.localeCompare(right.file_name)
    })
}

export async function listDatabaseDumpTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY name ASC`,
    )
    .all<{ name: string }>()

  return (result.results ?? [])
    .map((row) => String(row.name || '').trim())
    .filter((tableName) => tableName && !isDatabaseDumpInternalTable(tableName))
}
