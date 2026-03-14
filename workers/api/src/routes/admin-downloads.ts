import { Hono, type Context } from 'hono'
import {
  claimAdminDownloadJobProcessing,
  createAdminDownloadJob,
  deleteAdminDownloadArtifactsForJobs,
  deleteAdminDownloadJobsByIds,
  getAdminDownloadArtifact,
  getAdminDownloadJob,
  listAdminDownloadArtifactsForJobs,
  listAdminDownloadJobs,
  listAdminDownloadJobsByIds,
  listAdminDownloadArtifacts,
  requeueStaleAdminDownloadJob,
  resetAdminDownloadJobForRetry,
  type AdminDownloadMode,
  type AdminDownloadScope,
  type AdminDownloadStatus,
  type AdminDownloadStream,
} from '../db/admin-download-jobs'
import type { AppContext } from '../types'
import { jsonError } from '../utils/http'
import { scheduleBackgroundTask } from './export-route-utils'
import { runAdminDownloadJob } from './admin-download-builder'
import {
  fullDatabaseDumpFileName,
  hasSqlDumpArtifacts,
  sortDatabaseDumpArtifactsForBundle,
} from './admin-download-dump'
import { analyzeDatabaseDumpRestore } from './admin-download-restore-analysis'
import { executeDatabaseDumpRestore } from './admin-download-restore-execute'
import {
  adminDownloadStaleBeforeIso,
  listOperationalTables,
  operationalBundleFileName,
  sortOperationalArtifactsForBundle,
} from './admin-download-operational'
import {
  buildAdminDownloadStatusBody,
  isRetryableAdminDownloadJob,
  MAX_DELETE_JOB_IDS,
  parseAdminDownloadBoolean,
  parseAdminDownloadJobIds,
  parseAdminDownloadLimit,
  VALID_ADMIN_DOWNLOAD_STATUSES,
} from './admin-download-route-helpers'

const VALID_STREAMS = new Set<AdminDownloadStream>(['canonical', 'optimized', 'operational'])
const VALID_SCOPES = new Set<AdminDownloadScope>(['all', 'home_loans', 'savings', 'term_deposits'])
const VALID_MODES = new Set<AdminDownloadMode>(['snapshot', 'delta'])
const VALID_STATUSES = new Set<AdminDownloadStatus>(VALID_ADMIN_DOWNLOAD_STATUSES)
const DATABASE_DUMP_STREAM: AdminDownloadStream = 'operational'
const DATABASE_DUMP_SCOPE: AdminDownloadScope = 'all'
const DATABASE_DUMP_MODE: AdminDownloadMode = 'snapshot'

async function continueAdminDownloadIfPending(c: Context<AppContext>, jobId: string): Promise<void> {
  let job = await getAdminDownloadJob(c.env.DB, jobId)
  if (!job || job.status === 'completed' || job.status === 'failed') return

  if (job.status === 'processing') {
    await requeueStaleAdminDownloadJob(c.env.DB, {
      jobId,
      staleBeforeIso: adminDownloadStaleBeforeIso(),
    })
    job = await getAdminDownloadJob(c.env.DB, jobId)
    if (!job || job.status === 'processing') return
  }

  if (job.status !== 'queued') return

  const claimed = await claimAdminDownloadJobProcessing(c.env.DB, jobId)
  if (!claimed) return

  const claimedJob = await getAdminDownloadJob(c.env.DB, jobId)
  if (!claimedJob) return

  const task = runAdminDownloadJob(c.env, claimedJob)
  if (!scheduleBackgroundTask(c, task)) {
    await task
  }
}

async function deleteArtifactKeys(bucket: R2Bucket, r2Keys: string[]): Promise<void> {
  const keys = Array.from(new Set(r2Keys.map((r2Key) => String(r2Key || '').trim()).filter(Boolean)))
  if (!keys.length) return
  const chunkSize = 500
  for (let index = 0; index < keys.length; index += chunkSize) {
    await bucket.delete(keys.slice(index, index + chunkSize))
  }
}

async function loadAdminDownloadJobWithArtifacts(c: Context<AppContext>, jobId: string) {
  await continueAdminDownloadIfPending(c, jobId)
  const job = await getAdminDownloadJob(c.env.DB, jobId)
  if (!job) return null
  const artifacts = await listAdminDownloadArtifacts(c.env.DB, job.job_id)
  return { job, artifacts }
}

export const adminDownloadRoutes = new Hono<AppContext>()

adminDownloadRoutes.get('/downloads', async (c) => {
  const stream = String(c.req.query('stream') || '').trim().toLowerCase() as AdminDownloadStream | ''
  const scope = String(c.req.query('scope') || '').trim().toLowerCase() as AdminDownloadScope | ''
  const status = String(c.req.query('status') || '').trim().toLowerCase() as AdminDownloadStatus | ''
  const limit = parseAdminDownloadLimit(c.req.query('limit'), 12)

  if (stream && !VALID_STREAMS.has(stream)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'stream must be canonical, optimized, or operational')
  }
  if (scope && !VALID_SCOPES.has(scope)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'scope must be all, home_loans, savings, or term_deposits')
  }
  if (status && !VALID_STATUSES.has(status)) {
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
        ...buildAdminDownloadStatusBody(job, artifacts),
      }
    }),
  )

  for (const job of jobs) {
    if (job.status === 'queued' || job.status === 'processing') {
      await continueAdminDownloadIfPending(c, job.job_id)
    }
  }

  return c.json({
    ok: true,
    count: withArtifacts.length,
    jobs: withArtifacts,
  })
})

adminDownloadRoutes.post('/downloads', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const stream = String(body.stream || DATABASE_DUMP_STREAM).trim().toLowerCase() as AdminDownloadStream
  const scope = String(body.scope || DATABASE_DUMP_SCOPE).trim().toLowerCase() as AdminDownloadScope
  const mode = String(body.mode || DATABASE_DUMP_MODE).trim().toLowerCase() as AdminDownloadMode
  const sinceCursorRaw = body.since_cursor ?? body.sinceCursor
  const includePayloadBodiesRaw = body.include_payload_bodies ?? body.includePayloadBodies

  if (!VALID_STREAMS.has(stream)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'stream must be operational for the full database dump')
  }
  if (!VALID_SCOPES.has(scope)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'scope must be all for the full database dump')
  }
  if (!VALID_MODES.has(mode)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'mode must be snapshot for the full database dump')
  }
  if (stream !== DATABASE_DUMP_STREAM || scope !== DATABASE_DUMP_SCOPE || mode !== DATABASE_DUMP_MODE) {
    return jsonError(
      c,
      400,
      'BAD_REQUEST',
      'Admin exports now support one job type only: a full database dump of the whole database.',
    )
  }
  if (sinceCursorRaw != null && String(sinceCursorRaw).trim() !== '' && Number(sinceCursorRaw) !== 0) {
    return jsonError(c, 400, 'BAD_REQUEST', 'Delta cursors are not supported for the full database dump.')
  }
  if (includePayloadBodiesRaw != null && String(includePayloadBodiesRaw).trim() !== '' && String(includePayloadBodiesRaw).trim() !== '0' && String(includePayloadBodiesRaw).trim().toLowerCase() !== 'false') {
    return jsonError(c, 400, 'BAD_REQUEST', 'Payload-body exports are not supported for the full database dump.')
  }

  const jobId = crypto.randomUUID()
  // The persisted format field is legacy metadata; the actual download file name determines the public artifact type.
  await createAdminDownloadJob(c.env.DB, {
    jobId,
    stream: DATABASE_DUMP_STREAM,
    scope: DATABASE_DUMP_SCOPE,
    mode: DATABASE_DUMP_MODE,
    format: 'jsonl_gzip',
    sinceCursor: null,
    includePayloadBodies: false,
  })

  const job = await getAdminDownloadJob(c.env.DB, jobId)
  if (!job) {
    return jsonError(c, 500, 'DOWNLOAD_JOB_MISSING', 'Download job was not persisted.')
  }

  await continueAdminDownloadIfPending(c, job.job_id)

  const artifacts = await listAdminDownloadArtifacts(c.env.DB, jobId)
  const updatedJob = (await getAdminDownloadJob(c.env.DB, jobId)) ?? job
  return c.json(buildAdminDownloadStatusBody(updatedJob, artifacts), 202)
})

adminDownloadRoutes.post('/downloads/:jobId/retry', async (c) => {
  const jobId = c.req.param('jobId')
  const job = await getAdminDownloadJob(c.env.DB, jobId)
  if (!job) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }
  if (!isRetryableAdminDownloadJob(job)) {
    return jsonError(c, 400, 'BAD_REQUEST', 'Only failed download jobs can be retried.')
  }
  if (job.stream !== DATABASE_DUMP_STREAM || job.mode !== DATABASE_DUMP_MODE || job.scope !== DATABASE_DUMP_SCOPE) {
    return jsonError(c, 400, 'BAD_REQUEST', 'Only full database dump jobs can be retried.')
  }

  const artifacts = await listAdminDownloadArtifacts(c.env.DB, jobId)
  await deleteArtifactKeys(
    c.env.RAW_BUCKET,
    artifacts.map((artifact) => artifact.r2_key),
  )
  await deleteAdminDownloadArtifactsForJobs(c.env.DB, [jobId])
  await resetAdminDownloadJobForRetry(c.env.DB, jobId)
  await continueAdminDownloadIfPending(c, jobId)

  const updatedJob = await getAdminDownloadJob(c.env.DB, jobId)
  if (!updatedJob) {
    return jsonError(c, 500, 'DOWNLOAD_JOB_MISSING', 'Download job was not persisted.')
  }
  const updatedArtifacts = await listAdminDownloadArtifacts(c.env.DB, jobId)
  return c.json(buildAdminDownloadStatusBody(updatedJob, updatedArtifacts), 202)
})

adminDownloadRoutes.delete('/downloads', async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const jobIds = parseAdminDownloadJobIds(body.job_ids ?? body.jobIds)
  if (!jobIds.length) {
    return jsonError(c, 400, 'BAD_REQUEST', 'job_ids must contain at least one job id')
  }
  if (jobIds.length > MAX_DELETE_JOB_IDS) {
    return jsonError(c, 400, 'BAD_REQUEST', `job_ids cannot exceed ${MAX_DELETE_JOB_IDS} entries`)
  }

  const jobs = await listAdminDownloadJobsByIds(c.env.DB, jobIds)
  const existingIds = new Set(jobs.map((job) => job.job_id))
  const missingJobIds = jobIds.filter((jobId) => !existingIds.has(jobId))
  const blockedJobIds = jobs
    .filter((job) => job.status === 'queued' || job.status === 'processing')
    .map((job) => job.job_id)

  if (blockedJobIds.length) {
    return jsonError(
      c,
      409,
      'DOWNLOAD_JOBS_ACTIVE',
      'Queued or processing download jobs cannot be deleted.',
      {
        blocked_job_ids: blockedJobIds,
        missing_job_ids: missingJobIds,
      },
    )
  }

  const deletableJobIds = jobs.map((job) => job.job_id)
  const artifacts = await listAdminDownloadArtifactsForJobs(c.env.DB, deletableJobIds)
  await deleteArtifactKeys(
    c.env.RAW_BUCKET,
    artifacts.map((artifact) => artifact.r2_key),
  )
  const deletedArtifactRows = await deleteAdminDownloadArtifactsForJobs(c.env.DB, deletableJobIds)
  const deletedJobRows = await deleteAdminDownloadJobsByIds(c.env.DB, deletableJobIds)

  return c.json({
    ok: true,
    deleted_job_ids: deletableJobIds,
    missing_job_ids: missingJobIds,
    deleted_job_count: deletedJobRows,
    deleted_artifact_count: deletedArtifactRows,
  })
})

adminDownloadRoutes.get('/downloads/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const state = await loadAdminDownloadJobWithArtifacts(c, jobId)
  if (!state) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }
  return c.json(buildAdminDownloadStatusBody(state.job, state.artifacts))
})

adminDownloadRoutes.get('/downloads/:jobId/restore/analysis', async (c) => {
  const state = await loadAdminDownloadJobWithArtifacts(c, c.req.param('jobId'))
  if (!state) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }
  const analysis = await analyzeDatabaseDumpRestore(c.env, state.job, state.artifacts)
  return c.json({
    ok: true,
    analysis,
  })
})

adminDownloadRoutes.post('/downloads/:jobId/restore', async (c) => {
  const state = await loadAdminDownloadJobWithArtifacts(c, c.req.param('jobId'))
  if (!state) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const force = parseAdminDownloadBoolean(
    body.force ?? body.confirmRestore ?? body.confirm_restore ?? body.confirmReplace ?? body.confirm_replace,
  )
  const analysis = await analyzeDatabaseDumpRestore(c.env, state.job, state.artifacts)
  if (!analysis.ready) {
    return jsonError(c, 409, 'DOWNLOAD_RESTORE_BLOCKED', 'Dump restore is blocked until the listed issues are fixed.', {
      analysis,
    })
  }
  if (analysis.requires_force && !force) {
    return jsonError(
      c,
      409,
      'DOWNLOAD_RESTORE_CONFIRMATION_REQUIRED',
      'This restore will replace or remove current data. Re-submit with force=true after reviewing the analysis.',
      {
        analysis,
      },
    )
  }

  try {
    const restored = await executeDatabaseDumpRestore(c.env, state.job, state.artifacts, { force, analysis })
    return c.json({
      ok: true,
      analysis: restored.analysis,
      restore: restored.result,
    })
  } catch (error) {
    return jsonError(c, 500, 'DOWNLOAD_RESTORE_FAILED', (error as Error)?.message || 'Dump restore failed.', {
      analysis,
    })
  }
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

adminDownloadRoutes.get('/downloads/:jobId/download', async (c) => {
  const jobId = c.req.param('jobId')
  await continueAdminDownloadIfPending(c, jobId)
  const job = await getAdminDownloadJob(c.env.DB, jobId)
  if (!job) {
    return jsonError(c, 404, 'NOT_FOUND', 'Download job not found.')
  }
  if (job.stream !== 'operational' || job.mode !== 'snapshot') {
    return jsonError(c, 400, 'BAD_REQUEST', 'Single-file download is only available for operational dump jobs.')
  }
  if (job.status !== 'completed') {
    return jsonError(c, 409, 'DOWNLOAD_NOT_READY', 'The database dump is still being prepared.')
  }

  const artifacts = await listAdminDownloadArtifacts(c.env.DB, job.job_id)
  const sqlDumpArtifacts = hasSqlDumpArtifacts(artifacts)
  const orderedArtifacts = sqlDumpArtifacts
    ? sortDatabaseDumpArtifactsForBundle(artifacts)
    : sortOperationalArtifactsForBundle(await listOperationalTables(c.env.DB), artifacts)
  if (orderedArtifacts.length === 0) {
    return jsonError(c, 404, 'DOWNLOAD_ARTIFACT_MISSING', 'Database dump parts are missing from storage.')
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const artifact of orderedArtifacts) {
          const object = await c.env.RAW_BUCKET.get(artifact.r2_key)
          if (!object) {
            throw new Error(`Missing database dump part: ${artifact.file_name}`)
          }
          if (!object.body) {
            controller.enqueue(new Uint8Array(await object.arrayBuffer()))
            continue
          }

          const reader = object.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) controller.enqueue(value)
          }
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${sqlDumpArtifacts ? fullDatabaseDumpFileName(job) : operationalBundleFileName(job)}"`,
      'Content-Type': 'application/gzip',
    },
  })
})
