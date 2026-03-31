import type { DatasetKind } from '../../../../packages/shared/src'
import type { Context, Hono } from 'hono'
import {
  completeExportJob,
  createExportJob,
  failExportJob,
  getExportJob,
  markExportJobProcessing,
  type ExportFormat,
  type ExportScope,
} from '../db/export-jobs'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import {
  exportContentType,
  exportFileExtension,
  exportR2Key,
  exportStatusBody,
  readRequestPayload,
  requestExportFormat,
  requestExportScope,
  scheduleBackgroundTask,
} from './export-route-utils'
import { guardPublicExportJob } from './public-write-gates'

type RequestPayload = Record<string, unknown>

type ExportArtifact = {
  body: string
  rowCount: number
}

type ExportJobInput<TFilters> = {
  jobId: string
  scope: ExportScope
  format: ExportFormat
  filters: TFilters
}

type ExportValidationError = {
  code: string
  message: string
}

type RegisterExportRouteOptions<TFilters> = {
  dataset: DatasetKind
  buildFilters: (payload: RequestPayload) => TFilters
  runExportJob: (env: AppContext['Bindings'], input: ExportJobInput<TFilters>) => Promise<void>
  validate?: (scope: ExportScope, filters: TFilters) => ExportValidationError | null
  routeBase?: string
  pathPrefix?: string
  guardCreateJob?: (c: Context<AppContext>) => Response | null
}

type RunDatasetExportJobOptions<TFilters> = ExportJobInput<TFilters> & {
  dataset: DatasetKind
  fileNamePrefix: string
  buildArtifact: (
    env: AppContext['Bindings'],
    scope: ExportScope,
    format: ExportFormat,
    filters: TFilters,
  ) => Promise<ExportArtifact>
  onError?: (error: unknown, input: ExportJobInput<TFilters>) => Promise<void> | void
}

export async function runDatasetExportJob<TFilters>(
  env: AppContext['Bindings'],
  options: RunDatasetExportJobOptions<TFilters>,
): Promise<void> {
  await markExportJobProcessing(env.DB, options.jobId)
  try {
    const artifact = await options.buildArtifact(env, options.scope, options.format, options.filters)
    const fileName = `${options.fileNamePrefix}-${options.scope}-${options.jobId}.${exportFileExtension(options.format)}`
    const contentType = exportContentType(options.format)
    const r2Key = exportR2Key(options.dataset, options.jobId, options.format)
    await env.RAW_BUCKET.put(r2Key, artifact.body, {
      httpMetadata: { contentType },
    })
    await completeExportJob(env.DB, {
      jobId: options.jobId,
      rowCount: artifact.rowCount,
      fileName,
      contentType,
      r2Key,
    })
  } catch (error) {
    if (options.onError) {
      await options.onError(error, {
        jobId: options.jobId,
        scope: options.scope,
        format: options.format,
        filters: options.filters,
      })
    }
    await failExportJob(env.DB, options.jobId, (error as Error)?.message || String(error))
  }
}

export function registerExportRoutes<TFilters>(
  routes: Hono<AppContext>,
  options: RegisterExportRouteOptions<TFilters>,
): void {
  const base = options.routeBase ? `/${String(options.routeBase).replace(/^\/+/, '').replace(/\/+$/, '')}` : ''

  routes.post(`${base}/exports`, async (c) => {
    const guard = options.guardCreateJob ? options.guardCreateJob(c) : guardPublicExportJob(c)
    if (guard) return guard

    const payload = {
      ...c.req.query(),
      ...readRequestPayload(await c.req.json<Record<string, unknown>>().catch(() => ({}))),
    }
    const format = requestExportFormat(payload)
    if (!format) {
      return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
    }
    const scope = requestExportScope(payload)
    const filters = options.buildFilters(payload)
    const validationError = options.validate?.(scope, filters)
    if (validationError) {
      return jsonError(c, 400, validationError.code, validationError.message)
    }

    const jobId = crypto.randomUUID()
    await createExportJob(c.env.DB, {
      jobId,
      dataset: options.dataset,
      exportScope: scope,
      format,
      filterJson: JSON.stringify(filters),
    })

    const task = options.runExportJob(c.env, { jobId, scope, format, filters })
    if (!scheduleBackgroundTask(c, task)) {
      await task
    }

    const job = await getExportJob(c.env.DB, jobId)
    if (!job) {
      return jsonError(c, 500, 'EXPORT_JOB_MISSING', 'Export job was not persisted.')
    }
    return c.json(exportStatusBody(job, options.pathPrefix ?? ''), 202)
  })

  routes.get(`${base}/exports/:jobId`, async (c) => {
    const job = await getExportJob(c.env.DB, c.req.param('jobId'))
    if (!job || job.dataset_kind !== options.dataset) {
      return jsonError(c, 404, 'NOT_FOUND', 'Export job not found.')
    }
    return c.json(exportStatusBody(job, options.pathPrefix ?? ''))
  })

  routes.get(`${base}/exports/:jobId/download`, async (c) => {
    const job = await getExportJob(c.env.DB, c.req.param('jobId'))
    if (!job || job.dataset_kind !== options.dataset) {
      return jsonError(c, 404, 'NOT_FOUND', 'Export job not found.')
    }
    if (job.status !== 'completed' || !job.r2_key) {
      return jsonError(c, 409, 'EXPORT_NOT_READY', 'Export artifact is not ready yet.')
    }
    const object = await c.env.RAW_BUCKET.get(job.r2_key)
    if (!object) {
      return jsonError(c, 404, 'EXPORT_ARTIFACT_MISSING', 'Export artifact is missing from storage.')
    }
    if (job.content_type) c.header('Content-Type', job.content_type)
    if (job.file_name) c.header('Content-Disposition', `attachment; filename="${job.file_name}"`)
    return c.body(await object.text())
  })
}
