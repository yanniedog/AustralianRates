import type { Hono } from 'hono'
import { createExportJob, getExportJob, markExportJobProcessing, completeExportJob, failExportJob, type ExportFormat, type ExportScope } from '../db/export-jobs'
import { queryTdRatesPaginated, queryTdTimeseries } from '../db/td-queries'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import { csvEscape } from '../utils/csv'
import {
  exportContentType,
  exportFileExtension,
  exportR2Key,
  exportStatusBody,
  readRequestPayload,
  requestBoolean,
  requestDir,
  requestExportFormat,
  requestExportScope,
  requestMode,
  requestNumber,
  requestSource,
  requestString,
  requestStringArray,
  scheduleBackgroundTask,
} from './export-route-utils'

type TdExportFilters = {
  startDate?: string
  endDate?: string
  bank?: string
  banks?: string[]
  termMonths?: string
  depositTier?: string
  interestPayment?: string
  minRate?: number
  maxRate?: number
  includeRemoved?: boolean
  sort?: string
  dir?: 'asc' | 'desc'
  mode?: 'all' | 'daily' | 'historical'
  sourceMode?: ReturnType<typeof requestSource>
  productKey?: string
  seriesKey?: string
}

function buildTdFilters(payload: Record<string, unknown>): TdExportFilters {
  return {
    startDate: requestString(payload, 'start_date'),
    endDate: requestString(payload, 'end_date'),
    bank: requestString(payload, 'bank'),
    banks: requestStringArray(payload, 'banks'),
    termMonths: requestString(payload, 'term_months'),
    depositTier: requestString(payload, 'deposit_tier'),
    interestPayment: requestString(payload, 'interest_payment'),
    minRate: requestNumber(payload, 'min_rate'),
    maxRate: requestNumber(payload, 'max_rate'),
    includeRemoved: requestBoolean(payload, 'include_removed'),
    sort: requestString(payload, 'sort'),
    dir: requestDir(payload),
    mode: requestMode(payload),
    sourceMode: requestSource(payload),
    productKey: requestString(payload, 'product_key') ?? requestString(payload, 'productKey'),
    seriesKey: requestString(payload, 'series_key'),
  }
}

function appendCsvChunk(lines: string[], state: { headers: string[] | null }, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return
  if (!state.headers) {
    state.headers = Object.keys(rows[0])
    lines.push(state.headers.join(','))
  }
  for (const row of rows) {
    lines.push(state.headers.map((header) => csvEscape(row[header])).join(','))
  }
}

function appendJsonChunk(parts: string[], state: { firstRow: boolean }, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    if (!state.firstRow) parts.push(',\n')
    parts.push(JSON.stringify(row))
    state.firstRow = false
  }
}

async function buildTdArtifact(
  db: D1Database,
  scope: ExportScope,
  format: ExportFormat,
  filters: TdExportFilters,
): Promise<{ body: string; rowCount: number }> {
  const csvLines: string[] = []
  const jsonRows: string[] = []
  const csvState = { headers: null as string[] | null }
  const jsonState = { firstRow: true }
  let rowCount = 0

  if (scope === 'timeseries') {
    if (!filters.productKey && !filters.seriesKey) {
      throw new Error('product_key_or_series_key_required')
    }
    let offset = 0
    while (true) {
      const rows = await queryTdTimeseries(db, {
        bank: filters.bank,
        banks: filters.banks,
        productKey: filters.productKey,
        seriesKey: filters.seriesKey,
        termMonths: filters.termMonths,
        depositTier: filters.depositTier,
        interestPayment: filters.interestPayment,
        minRate: filters.minRate,
        maxRate: filters.maxRate,
        includeRemoved: filters.includeRemoved,
        mode: filters.mode,
        sourceMode: filters.sourceMode,
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: 1000,
        offset,
      })
      if (rows.length === 0) break
      rowCount += rows.length
      if (format === 'csv') appendCsvChunk(csvLines, csvState, rows as Array<Record<string, unknown>>)
      else appendJsonChunk(jsonRows, jsonState, rows as Array<Record<string, unknown>>)
      if (rows.length < 1000) break
      offset += rows.length
    }
  } else {
    let page = 1
    let lastPage = 1
    do {
      const result = await queryTdRatesPaginated(db, {
        page,
        size: 1000,
        startDate: filters.startDate,
        endDate: filters.endDate,
        bank: filters.bank,
        banks: filters.banks,
        termMonths: filters.termMonths,
        depositTier: filters.depositTier,
        interestPayment: filters.interestPayment,
        minRate: filters.minRate,
        maxRate: filters.maxRate,
        includeRemoved: filters.includeRemoved,
        sort: filters.sort,
        dir: filters.dir,
        mode: filters.mode,
        sourceMode: filters.sourceMode,
      })
      lastPage = result.last_page
      rowCount += result.data.length
      if (format === 'csv') appendCsvChunk(csvLines, csvState, result.data as Array<Record<string, unknown>>)
      else appendJsonChunk(jsonRows, jsonState, result.data as Array<Record<string, unknown>>)
      page += 1
    } while (page <= lastPage)
  }

  if (format === 'csv') {
    return { body: csvLines.join('\n'), rowCount }
  }

  return {
    body: `{"ok":true,"dataset":"term_deposits","export_scope":"${scope}","count":${rowCount},"rows":[${jsonRows.join('')}]}`,
    rowCount,
  }
}

async function runTdExportJob(
  env: AppContext['Bindings'],
  input: {
    jobId: string
    scope: ExportScope
    format: ExportFormat
    filters: TdExportFilters
  },
): Promise<void> {
  await markExportJobProcessing(env.DB, input.jobId)
  try {
    const artifact = await buildTdArtifact(env.DB, input.scope, input.format, input.filters)
    const fileName = `term-deposit-rates-${input.scope}-${input.jobId}.${exportFileExtension(input.format)}`
    const contentType = exportContentType(input.format)
    const r2Key = exportR2Key('term_deposits', input.jobId, input.format)
    await env.RAW_BUCKET.put(r2Key, artifact.body, {
      httpMetadata: { contentType },
    })
    await completeExportJob(env.DB, {
      jobId: input.jobId,
      rowCount: artifact.rowCount,
      fileName,
      contentType,
      r2Key,
    })
  } catch (error) {
    await failExportJob(env.DB, input.jobId, (error as Error)?.message || String(error))
  }
}

export function registerTdExportRoutes(routes: Hono<AppContext>): void {
  routes.post('/exports', async (c) => {
    const payload = {
      ...c.req.query(),
      ...readRequestPayload(await c.req.json<Record<string, unknown>>().catch(() => ({}))),
    }
    const format = requestExportFormat(payload)
    if (!format) {
      return jsonError(c, 400, 'INVALID_FORMAT', 'format must be csv or json')
    }
    const scope = requestExportScope(payload)
    const filters = buildTdFilters(payload)
    if (scope === 'timeseries' && !filters.productKey && !filters.seriesKey) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'product_key or series_key is required for timeseries exports.')
    }

    const jobId = crypto.randomUUID()
    await createExportJob(c.env.DB, {
      jobId,
      dataset: 'term_deposits',
      exportScope: scope,
      format,
      filterJson: JSON.stringify(filters),
    })

    const task = runTdExportJob(c.env, { jobId, scope, format, filters })
    if (!scheduleBackgroundTask(c, task)) {
      await task
    }

    const job = await getExportJob(c.env.DB, jobId)
    if (!job) {
      return jsonError(c, 500, 'EXPORT_JOB_MISSING', 'Export job was not persisted.')
    }
    return c.json(exportStatusBody(job, ''), 202)
  })

  routes.get('/exports/:jobId', async (c) => {
    const job = await getExportJob(c.env.DB, c.req.param('jobId'))
    if (!job || job.dataset_kind !== 'term_deposits') {
      return jsonError(c, 404, 'NOT_FOUND', 'Export job not found.')
    }
    return c.json(exportStatusBody(job, ''))
  })

  routes.get('/exports/:jobId/download', async (c) => {
    const job = await getExportJob(c.env.DB, c.req.param('jobId'))
    if (!job || job.dataset_kind !== 'term_deposits') {
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
