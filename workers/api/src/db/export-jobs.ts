import type { DatasetKind } from '../../../../packages/shared/src'

export type ExportFormat = 'csv' | 'json'
export type ExportScope = 'rates' | 'timeseries'
export type ExportJobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type ExportJobRow = {
  job_id: string
  dataset_kind: DatasetKind
  export_scope: ExportScope
  format: ExportFormat
  status: ExportJobStatus
  filter_json: string
  requested_at: string
  started_at: string | null
  completed_at: string | null
  file_name: string | null
  content_type: string | null
  row_count: number | null
  r2_key: string | null
  error_message: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function createExportJob(
  db: D1Database,
  input: {
    jobId: string
    dataset: DatasetKind
    exportScope: ExportScope
    format: ExportFormat
    filterJson: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO export_jobs (
         job_id, dataset_kind, export_scope, format, status, filter_json, requested_at
       ) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6)`,
    )
    .bind(input.jobId, input.dataset, input.exportScope, input.format, input.filterJson, nowIso())
    .run()
}

export async function markExportJobProcessing(db: D1Database, jobId: string): Promise<void> {
  const now = nowIso()
  await db
    .prepare(
      `UPDATE export_jobs
       SET status = 'processing',
           started_at = COALESCE(started_at, ?1)
       WHERE job_id = ?2`,
    )
    .bind(now, jobId)
    .run()
}

export async function completeExportJob(
  db: D1Database,
  input: {
    jobId: string
    rowCount: number
    fileName: string
    contentType: string
    r2Key: string
  },
): Promise<void> {
  const now = nowIso()
  await db
    .prepare(
      `UPDATE export_jobs
       SET status = 'completed',
           completed_at = ?1,
           row_count = ?2,
           file_name = ?3,
           content_type = ?4,
           r2_key = ?5,
           error_message = NULL
       WHERE job_id = ?6`,
    )
    .bind(now, input.rowCount, input.fileName, input.contentType, input.r2Key, input.jobId)
    .run()
}

export async function failExportJob(db: D1Database, jobId: string, errorMessage: string): Promise<void> {
  const now = nowIso()
  await db
    .prepare(
      `UPDATE export_jobs
       SET status = 'failed',
           completed_at = ?1,
           error_message = ?2
       WHERE job_id = ?3`,
    )
    .bind(now, errorMessage.slice(0, 2000), jobId)
    .run()
}

export async function getExportJob(db: D1Database, jobId: string): Promise<ExportJobRow | null> {
  const row = await db
    .prepare(
      `SELECT
         job_id, dataset_kind, export_scope, format, status, filter_json, requested_at,
         started_at, completed_at, file_name, content_type, row_count, r2_key, error_message
       FROM export_jobs
       WHERE job_id = ?1`,
    )
    .bind(jobId)
    .first<ExportJobRow>()
  return row ?? null
}
