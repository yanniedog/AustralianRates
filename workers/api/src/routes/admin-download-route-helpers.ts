import type { AdminDownloadArtifactRow, AdminDownloadJobRow } from '../db/admin-download-jobs'
import { operationalBundleFileName } from './admin-download-operational'

export const DEFAULT_ADMIN_DOWNLOAD_LIMIT = 12
export const MAX_ADMIN_DOWNLOAD_LIMIT = 250
export const MAX_DELETE_JOB_IDS = 100
export const VALID_ADMIN_DOWNLOAD_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const

export function parseAdminDownloadBoolean(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function parseAdminDownloadLimit(value: string | undefined, fallback = DEFAULT_ADMIN_DOWNLOAD_LIMIT): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(MAX_ADMIN_DOWNLOAD_LIMIT, parsed))
}

export function parseAdminDownloadJobIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((jobId) => String(jobId || '').trim()).filter(Boolean)))
}

export function normalizeAdminDownloadSinceCursor(value: unknown): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

export function isRetryableAdminDownloadJob(job: Pick<AdminDownloadJobRow, 'status'> | null | undefined): boolean {
  return String(job?.status || '') === 'failed'
}

export function buildAdminDownloadStatusBody(job: AdminDownloadJobRow, artifacts: AdminDownloadArtifactRow[]) {
  const downloadPath =
    job.stream === 'operational' && job.mode === 'snapshot' && job.status === 'completed'
      ? `/admin/downloads/${job.job_id}/download`
      : null
  const downloadFileName = downloadPath ? operationalBundleFileName(job) : null

  return {
    ok: true,
    job,
    download_path: downloadPath,
    download_file_name: downloadFileName,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      download_path: `/admin/downloads/${job.job_id}/artifacts/${artifact.artifact_id}/download`,
    })),
  }
}
