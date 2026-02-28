import type { DatasetKind } from '../../../../packages/shared/src'
import type { ExportFormat, ExportJobRow, ExportScope } from '../db/export-jobs'
import { parseSourceMode, type SourceMode } from '../utils/source-mode'

type RequestPayload = Record<string, unknown>

export function readRequestPayload(value: unknown): RequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as RequestPayload
}

export function requestString(payload: RequestPayload, key: string): string | undefined {
  const value = payload[key]
  if (value == null) return undefined
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).join(',')
  const text = String(value).trim()
  return text ? text : undefined
}

export function requestNumber(payload: RequestPayload, key: string): number | undefined {
  const value = payload[key]
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function requestStringArray(payload: RequestPayload, key: string): string[] {
  const value = payload[key]
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)))
  }
  const text = requestString(payload, key)
  if (!text) return []
  return Array.from(new Set(text.split(',').map((item) => item.trim()).filter(Boolean)))
}

export function requestBoolean(payload: RequestPayload, key: string): boolean {
  const value = payload[key]
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function requestMode(payload: RequestPayload): 'all' | 'daily' | 'historical' {
  const value = String(payload.mode ?? 'all').trim().toLowerCase()
  return value === 'daily' || value === 'historical' ? value : 'all'
}

export function requestDir(payload: RequestPayload): 'asc' | 'desc' {
  const value = String(payload.dir ?? 'desc').trim().toLowerCase()
  return value === 'asc' ? 'asc' : 'desc'
}

export function requestSource(payload: RequestPayload): SourceMode {
  return parseSourceMode(requestString(payload, 'source_mode'), requestString(payload, 'include_manual'))
}

export function requestExportFormat(payload: RequestPayload): ExportFormat | null {
  const format = String(payload.format ?? 'csv').trim().toLowerCase()
  return format === 'csv' || format === 'json' ? format : null
}

export function requestExportScope(payload: RequestPayload): ExportScope {
  const scope = String(payload.export_type ?? payload.dataset ?? 'rates').trim().toLowerCase()
  return scope === 'timeseries' ? 'timeseries' : 'rates'
}

export function exportContentType(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8'
}

export function exportFileExtension(format: ExportFormat): string {
  return format === 'csv' ? 'csv' : 'json'
}

export function exportR2Key(dataset: DatasetKind, jobId: string, format: ExportFormat): string {
  return `exports/${dataset}/${jobId}.${exportFileExtension(format)}`
}

export function exportStatusBody(job: ExportJobRow, pathPrefix: string) {
  return {
    ok: true,
    job_id: job.job_id,
    dataset: job.dataset_kind,
    export_scope: job.export_scope,
    format: job.format,
    status: job.status,
    requested_at: job.requested_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    row_count: job.row_count,
    file_name: job.file_name,
    error_message: job.error_message,
    status_path: `${pathPrefix}/exports/${job.job_id}`,
    download_path: job.status === 'completed' ? `${pathPrefix}/exports/${job.job_id}/download` : null,
  }
}

export function scheduleBackgroundTask(context: unknown, task: Promise<unknown>): boolean {
  const executionCtx = (context as { executionCtx?: ExecutionContext }).executionCtx
  if (!executionCtx) return false
  executionCtx.waitUntil(task)
  return true
}
