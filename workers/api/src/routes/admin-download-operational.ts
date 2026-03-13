import type { AdminDownloadJobRow, AdminDownloadArtifactRow } from '../db/admin-download-jobs'

const OPERATIONAL_INTERNAL_PREFIXES = ['sqlite_', '_cf_']

export const OPERATIONAL_SNAPSHOT_ROW_BATCH_SIZE = 10_000
export const OPERATIONAL_SNAPSHOT_CHUNKS_PER_PASS = 2
export const ADMIN_DOWNLOAD_STALE_MS = 90_000

export function isOperationalInternalTable(tableName: string): boolean {
  const normalized = String(tableName || '').trim().toLowerCase()
  if (!normalized) return true
  return OPERATIONAL_INTERNAL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function isProtectedOperationalTableError(error: unknown): boolean {
  const message = (error as Error)?.message || String(error || '')
  return message.includes('SQLITE_AUTH') && message.includes('access to')
}

export function adminDownloadStaleBeforeIso(now = Date.now()): string {
  return new Date(now - ADMIN_DOWNLOAD_STALE_MS).toISOString()
}

function sanitizeFileSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'table'
}

const OPERATIONAL_MAIN_FILE_RE = /^operational-[a-z_]+-snapshot-([A-Za-z0-9_-]+)-offset-(\d+)\.jsonl\.gz$/i

export function operationalSnapshotFileName(job: AdminDownloadJobRow, tableName: string, offset: number): string {
  return `${job.stream}-${job.scope}-${job.mode}-${sanitizeFileSegment(tableName)}-offset-${String(Math.max(0, Math.floor(offset))).padStart(8, '0')}.jsonl.gz`
}

export function operationalManifestFileName(job: AdminDownloadJobRow): string {
  return `${job.stream}-${job.scope}-${job.mode}-manifest.jsonl.gz`
}

export function operationalSnapshotR2Key(jobId: string, fileName: string): string {
  return `admin-downloads/${jobId}/${fileName}`
}

export function operationalArtifactTableName(fileName: string): string | null {
  const match = OPERATIONAL_MAIN_FILE_RE.exec(String(fileName || '').trim())
  return match ? match[1] : null
}

export function operationalArtifactOffset(fileName: string): number | null {
  const match = OPERATIONAL_MAIN_FILE_RE.exec(String(fileName || '').trim())
  if (!match) return null
  const parsed = Number(match[2])
  return Number.isFinite(parsed) ? parsed : null
}

export function operationalProgressByTable(artifacts: AdminDownloadArtifactRow[]): Map<string, number> {
  const progress = new Map<string, number>()
  for (const artifact of artifacts) {
    if (artifact.artifact_kind !== 'main') continue
    const tableName = operationalArtifactTableName(artifact.file_name)
    if (!tableName) continue
    const endOffset = Number(artifact.cursor_end ?? 0)
    if (!Number.isFinite(endOffset) || endOffset < 0) continue
    const current = progress.get(tableName) ?? 0
    if (endOffset > current) progress.set(tableName, endOffset)
  }
  return progress
}

export async function listOperationalTables(db: D1Database): Promise<string[]> {
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
    .filter((tableName) => tableName && !isOperationalInternalTable(tableName))
}
