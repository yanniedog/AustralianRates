export type AdminDownloadStream = 'canonical' | 'optimized' | 'operational'
export type AdminDownloadScope = 'all' | 'home_loans' | 'savings' | 'term_deposits'
export type AdminDownloadMode = 'snapshot' | 'delta'
export type AdminDownloadFormat = 'jsonl_gzip'
export type AdminDownloadStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type AdminDownloadArtifactKind = 'main' | 'payload_bodies' | 'manifest'
export type AdminDownloadExportKind = 'full' | 'monthly'

export type AdminDownloadJobRow = {
  job_id: string
  stream: AdminDownloadStream
  scope: AdminDownloadScope
  mode: AdminDownloadMode
  format: AdminDownloadFormat
  since_cursor: number | null
  end_cursor: number | null
  include_payload_bodies: number
  status: AdminDownloadStatus
  requested_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  export_kind: AdminDownloadExportKind
  month_iso: string | null
}

export type AdminDownloadArtifactRow = {
  artifact_id: string
  job_id: string
  artifact_kind: AdminDownloadArtifactKind
  file_name: string
  content_type: string
  row_count: number | null
  byte_size: number | null
  cursor_start: number | null
  cursor_end: number | null
  r2_key: string
  created_at: string
}

function normalizeJobIds(jobIds: string[]): string[] {
  return Array.from(new Set(jobIds.map((jobId) => String(jobId || '').trim()).filter(Boolean)))
}

function inClausePlaceholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(', ')
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function createAdminDownloadJob(
  db: D1Database,
  input: {
    jobId: string
    stream: AdminDownloadStream
    scope: AdminDownloadScope
    mode: AdminDownloadMode
    format: AdminDownloadFormat
    sinceCursor?: number | null
    includePayloadBodies?: boolean
    exportKind?: AdminDownloadExportKind
    monthIso?: string | null
  },
): Promise<void> {
  const exportKind = input.exportKind ?? 'full'
  const monthIso = input.monthIso ?? null
  await db
    .prepare(
      `INSERT INTO admin_download_jobs (
         job_id, stream, scope, mode, format, since_cursor, include_payload_bodies, status, requested_at, export_kind, month_iso
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?9, ?10)`,
    )
    .bind(
      input.jobId,
      input.stream,
      input.scope,
      input.mode,
      input.format,
      input.sinceCursor ?? null,
      input.includePayloadBodies ? 1 : 0,
      nowIso(),
      exportKind,
      monthIso,
    )
    .run()
}

export async function markAdminDownloadJobProcessing(db: D1Database, jobId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'processing',
           started_at = ?1,
           completed_at = NULL,
           error_message = NULL
       WHERE job_id = ?2`,
    )
    .bind(nowIso(), jobId)
    .run()
}

export async function claimAdminDownloadJobProcessing(db: D1Database, jobId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'processing',
           started_at = ?1,
           completed_at = NULL,
           error_message = NULL
       WHERE job_id = ?2
         AND status = 'queued'`,
    )
    .bind(nowIso(), jobId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function requeueAdminDownloadJob(db: D1Database, jobId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'queued',
           completed_at = NULL,
           error_message = NULL
       WHERE job_id = ?1`,
    )
    .bind(jobId)
    .run()
}

export async function resetAdminDownloadJobForRetry(db: D1Database, jobId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'queued',
           started_at = NULL,
           completed_at = NULL,
           end_cursor = NULL,
           error_message = NULL
       WHERE job_id = ?1`,
    )
    .bind(jobId)
    .run()
}

export async function requeueStaleAdminDownloadJob(
  db: D1Database,
  input: { jobId: string; staleBeforeIso: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'queued',
           completed_at = NULL,
           error_message = NULL
       WHERE job_id = ?1
         AND status = 'processing'
         AND started_at IS NOT NULL
         AND started_at <= ?2`,
    )
    .bind(input.jobId, input.staleBeforeIso)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function completeAdminDownloadJob(
  db: D1Database,
  input: { jobId: string; endCursor?: number | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'completed',
           completed_at = ?1,
           end_cursor = COALESCE(?2, end_cursor),
           error_message = NULL
       WHERE job_id = ?3`,
    )
    .bind(nowIso(), input.endCursor ?? null, input.jobId)
    .run()
}

export async function failAdminDownloadJob(db: D1Database, jobId: string, errorMessage: string): Promise<void> {
  await db
    .prepare(
      `UPDATE admin_download_jobs
       SET status = 'failed',
           completed_at = ?1,
           error_message = ?2
       WHERE job_id = ?3`,
    )
    .bind(nowIso(), errorMessage.slice(0, 2000), jobId)
    .run()
}

export async function addAdminDownloadArtifact(
  db: D1Database,
  input: {
    artifactId: string
    jobId: string
    artifactKind: AdminDownloadArtifactKind
    fileName: string
    contentType: string
    rowCount?: number | null
    byteSize?: number | null
    cursorStart?: number | null
    cursorEnd?: number | null
    r2Key: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_download_artifacts (
         artifact_id, job_id, artifact_kind, file_name, content_type, row_count, byte_size, cursor_start, cursor_end, r2_key
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      input.artifactId,
      input.jobId,
      input.artifactKind,
      input.fileName,
      input.contentType,
      input.rowCount ?? null,
      input.byteSize ?? null,
      input.cursorStart ?? null,
      input.cursorEnd ?? null,
      input.r2Key,
    )
    .run()
}

export async function getAdminDownloadJob(db: D1Database, jobId: string): Promise<AdminDownloadJobRow | null> {
  const row = await db
    .prepare(
      `SELECT
         job_id, stream, scope, mode, format, since_cursor, end_cursor, include_payload_bodies,
         status, requested_at, started_at, completed_at, error_message, export_kind, month_iso
       FROM admin_download_jobs
       WHERE job_id = ?1`,
    )
    .bind(jobId)
    .first<AdminDownloadJobRow>()
  if (!row) return null
  return {
    ...row,
    export_kind: (row as AdminDownloadJobRow & { export_kind?: string }).export_kind ?? 'full',
    month_iso: (row as AdminDownloadJobRow & { month_iso?: string | null }).month_iso ?? null,
  }
}

export async function listAdminDownloadJobs(
  db: D1Database,
  input?: {
    stream?: AdminDownloadStream
    scope?: AdminDownloadScope
    status?: AdminDownloadStatus
    limit?: number
  },
): Promise<AdminDownloadJobRow[]> {
  const where: string[] = []
  const binds: Array<string | number> = []
  if (input?.stream) {
    where.push(`stream = ?${binds.length + 1}`)
    binds.push(input.stream)
  }
  if (input?.scope) {
    where.push(`scope = ?${binds.length + 1}`)
    binds.push(input.scope)
  }
  if (input?.status) {
    where.push(`status = ?${binds.length + 1}`)
    binds.push(input.status)
  }
  const limit = Math.max(1, Math.min(250, Math.floor(Number(input?.limit ?? 20))))
  binds.push(limit)
  const result = await db
    .prepare(
      `SELECT
         job_id, stream, scope, mode, format, since_cursor, end_cursor, include_payload_bodies,
         status, requested_at, started_at, completed_at, error_message, export_kind, month_iso
       FROM admin_download_jobs
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY requested_at DESC
       LIMIT ?${binds.length}`,
    )
    .bind(...binds)
    .all<AdminDownloadJobRow & { export_kind?: string; month_iso?: string | null }>()
  const rows = result.results ?? []
  return rows.map((row) => ({
    ...row,
    export_kind: (row.export_kind ?? 'full') as AdminDownloadExportKind,
    month_iso: row.month_iso ?? null,
  }))
}

export async function listAdminDownloadJobsByIds(db: D1Database, jobIds: string[]): Promise<AdminDownloadJobRow[]> {
  const ids = normalizeJobIds(jobIds)
  if (!ids.length) return []
  const result = await db
    .prepare(
      `SELECT
         job_id, stream, scope, mode, format, since_cursor, end_cursor, include_payload_bodies,
         status, requested_at, started_at, completed_at, error_message, export_kind, month_iso
       FROM admin_download_jobs
       WHERE job_id IN (${inClausePlaceholders(ids.length)})
       ORDER BY requested_at DESC`,
    )
    .bind(...ids)
    .all<AdminDownloadJobRow & { export_kind?: string; month_iso?: string | null }>()
  const rows = result.results ?? []
  return rows.map((row) => ({
    ...row,
    export_kind: (row.export_kind ?? 'full') as AdminDownloadExportKind,
    month_iso: row.month_iso ?? null,
  }))
}

export async function listAdminDownloadArtifacts(db: D1Database, jobId: string): Promise<AdminDownloadArtifactRow[]> {
  const result = await db
    .prepare(
      `SELECT
         artifact_id, job_id, artifact_kind, file_name, content_type, row_count, byte_size, cursor_start, cursor_end, r2_key, created_at
       FROM admin_download_artifacts
       WHERE job_id = ?1
       ORDER BY created_at ASC, artifact_kind ASC`,
    )
    .bind(jobId)
    .all<AdminDownloadArtifactRow>()
  return result.results ?? []
}

export async function listAdminDownloadArtifactsForJobs(
  db: D1Database,
  jobIds: string[],
): Promise<AdminDownloadArtifactRow[]> {
  const ids = normalizeJobIds(jobIds)
  if (!ids.length) return []
  const result = await db
    .prepare(
      `SELECT
         artifact_id, job_id, artifact_kind, file_name, content_type, row_count, byte_size, cursor_start, cursor_end, r2_key, created_at
       FROM admin_download_artifacts
       WHERE job_id IN (${inClausePlaceholders(ids.length)})
       ORDER BY created_at ASC, artifact_kind ASC`,
    )
    .bind(...ids)
    .all<AdminDownloadArtifactRow>()
  return result.results ?? []
}

export async function getAdminDownloadArtifact(db: D1Database, artifactId: string): Promise<AdminDownloadArtifactRow | null> {
  const row = await db
    .prepare(
      `SELECT
         artifact_id, job_id, artifact_kind, file_name, content_type, row_count, byte_size, cursor_start, cursor_end, r2_key, created_at
       FROM admin_download_artifacts
       WHERE artifact_id = ?1`,
    )
    .bind(artifactId)
    .first<AdminDownloadArtifactRow>()
  return row ?? null
}

export async function deleteAdminDownloadArtifactsForJobs(db: D1Database, jobIds: string[]): Promise<number> {
  const ids = normalizeJobIds(jobIds)
  if (!ids.length) return 0
  const result = await db
    .prepare(
      `DELETE FROM admin_download_artifacts
       WHERE job_id IN (${inClausePlaceholders(ids.length)})`,
    )
    .bind(...ids)
    .run()
  return result.meta.changes ?? 0
}

export async function deleteAdminDownloadJobsByIds(db: D1Database, jobIds: string[]): Promise<number> {
  const ids = normalizeJobIds(jobIds)
  if (!ids.length) return 0
  const result = await db
    .prepare(
      `DELETE FROM admin_download_jobs
       WHERE job_id IN (${inClausePlaceholders(ids.length)})`,
    )
    .bind(...ids)
    .run()
  return result.meta.changes ?? 0
}
