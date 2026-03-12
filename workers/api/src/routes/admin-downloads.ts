import { Hono } from 'hono'
import {
  createAdminDownloadJob,
  getAdminDownloadArtifact,
  getAdminDownloadJob,
  listAdminDownloadJobs,
  listAdminDownloadArtifacts,
  type AdminDownloadMode,
  type AdminDownloadScope,
  type AdminDownloadStatus,
  type AdminDownloadStream,
} from '../db/admin-download-jobs'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import { scheduleBackgroundTask } from './export-route-utils'
import { runAdminDownloadJob } from './admin-download-builder'

const VALID_STREAMS = new Set<AdminDownloadStream>(['canonical', 'optimized', 'operational'])
const VALID_SCOPES = new Set<AdminDownloadScope>(['all', 'home_loans', 'savings', 'term_deposits'])
const VALID_MODES = new Set<AdminDownloadMode>(['snapshot', 'delta'])

function parseBoolean(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(100, parsed))
}

function statusBody(job: Awaited<ReturnType<typeof getAdminDownloadJob>>, artifacts: Awaited<ReturnType<typeof listAdminDownloadArtifacts>>) {
  return {
    ok: true,
    job,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      download_path: `/admin/downloads/${job?.job_id}/artifacts/${artifact.artifact_id}/download`,
    })),
  }
}

export const adminDownloadRoutes = new Hono<AppContext>()

adminDownloadRoutes.get('/downloads', async (c) => {
  const stream = String(c.req.query('stream') || '').trim().toLowerCase() as AdminDownloadStream | ''
  const scope = String(c.req.query('scope') || '').trim().toLowerCase() as AdminDownloadScope | ''
  const status = String(c.req.query('status') || '').trim().toLowerCase() as AdminDownloadStatus | ''
  const limit = parseLimit(c.req.query('limit'), 12)

  if (stream && !VALID_STREAMS.has(stream)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'stream must be canonical, optimized, or operational')
  }
  if (scope && !VALID_SCOPES.has(scope)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'scope must be all, home_loans, savings, or term_deposits')
  }
  if (status && !new Set<AdminDownloadStatus>(['queued', 'processing', 'completed', 'failed']).has(status)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'status must be queued, processing, completed, or failed')
  }

  const jobs = await listAdminDownloadJobs(c.env.DB, {
    stream: stream || undefined,
    scope: scope || undefined,
    status: status || undefined,
    limit,
  })
  const withArtifacts = await Promise.all(
    jobs.map(async (job) => {
      const artifacts = await listAdminDownloadArtifacts(c.env.DB, job.job_id)
      return {
        ...statusBody(job, artifacts),
      }
    }),
  )

  return c.json({
    ok: true,
    count: withArtifacts.length,
    jobs: withArtifacts,
  })
})

adminDownloadRoutes.post('/downloads', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const stream = String(body.stream || '').trim().toLowerCase() as AdminDownloadStream
  const scope = String(body.scope || 'all').trim().toLowerCase() as AdminDownloadScope
  const mode = String(body.mode || 'snapshot').trim().toLowerCase() as AdminDownloadMode
  const sinceCursor = Number(body.since_cursor ?? body.sinceCursor ?? 0)
  const includePayloadBodies = parseBoolean(body.include_payload_bodies ?? body.includePayloadBodies)

  if (!VALID_STREAMS.has(stream)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'stream must be canonical, optimized, or operational')
  }
  if (!VALID_SCOPES.has(scope)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'scope must be all, home_loans, savings, or term_deposits')
  }
  if (!VALID_MODES.has(mode)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'mode must be snapshot or delta')
  }
  if (stream === 'operational' && mode !== 'snapshot') {
    return jsonError(c, 400, 'BAD_REQUEST', 'operational downloads currently support snapshot mode only')
  }

  const jobId = crypto.randomUUID()
  await createAdminDownloadJob(c.env.DB, {
    jobId,
    stream,
    scope,
    mode,
    format: 'jsonl_gzip',
    sinceCursor: mode === 'delta' ? Math.max(0, Math.floor(sinceCursor || 0)) : null,
    includePayloadBodies: stream === 'canonical' && includePayloadBodies,
  })

  const job = await getAdminDownloadJob(c.env.DB, jobId)
  if (!job) {
    return jsonError(c, 500, 'DOWNLOAD_JOB_MISSING', 'Download job was not persisted.')
  }

  const task = runAdminDownloadJob(c.env, job)
  if (!scheduleBackgroundTask(c, task)) {
    await task
  }

  const artifacts = await listAdminDownloadArtifacts(c.env.DB, jobId)
  return c.json(statusBody(job, artifacts), 202)
})

adminDownloadRoutes.get('/downloads/:jobId', async (c) => {
  const job = await getAdminDownloadJob(c.env.DB, c.req.param('jobId'))
  if (!job) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }
  const artifacts = await listAdminDownloadArtifacts(c.env.DB, job.job_id)
  return c.json(statusBody(job, artifacts))
})

adminDownloadRoutes.get('/downloads/:jobId/artifacts/:artifactId/download', async (c) => {
  const job = await getAdminDownloadJob(c.env.DB, c.req.param('jobId'))
  if (!job) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }
  const artifact = await getAdminDownloadArtifact(c.env.DB, c.req.param('artifactId'))
  if (!artifact || artifact.job_id !== job.job_id) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download artifact not found.')
  }
  const object = await c.env.RAW_BUCKET.get(artifact.r2_key)
  if (!object) {
    return jsonError(c, 404, 'DOWNLOAD_ARTIFACT_MISSING', 'Download artifact is missing from storage.')
  }
  c.header('Content-Type', artifact.content_type || 'application/gzip')
  c.header('Content-Disposition', `attachment; filename="${artifact.file_name}"`)
  return c.body(await object.arrayBuffer())
})
