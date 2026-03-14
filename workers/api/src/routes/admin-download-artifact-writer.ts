import {
  addAdminDownloadArtifact,
  type AdminDownloadArtifactKind,
  type AdminDownloadJobRow,
} from '../db/admin-download-jobs'
import { gzipCompressText } from '../utils/compression'

export type AdminDownloadEnv = {
  DB: D1Database
  READ_DB?: D1Database
  RAW_BUCKET: R2Bucket
}

const DEFAULT_CONTENT_TYPE = 'application/gzip'

function defaultArtifactFileName(job: AdminDownloadJobRow, artifactKind: AdminDownloadArtifactKind): string {
  return `${job.stream}-${job.scope}-${job.mode}${artifactKind === 'payload_bodies' ? '-payloads' : ''}.jsonl.gz`
}

function defaultArtifactR2Key(jobId: string, artifactKind: AdminDownloadArtifactKind): string {
  return `admin-downloads/${jobId}/${artifactKind}.jsonl.gz`
}

export async function writeAdminDownloadArtifact(
  env: AdminDownloadEnv,
  db: D1Database,
  job: AdminDownloadJobRow,
  artifactKind: AdminDownloadArtifactKind,
  lines: string[],
  rowCount: number,
  cursorStart?: number | null,
  cursorEnd?: number | null,
  options?: { fileName?: string; r2Key?: string; contentType?: string },
): Promise<void> {
  const body = `${lines.join('\n')}\n`
  const compressed = await gzipCompressText(body)
  const artifactId = crypto.randomUUID()
  const r2Key = options?.r2Key || defaultArtifactR2Key(job.job_id, artifactKind)
  const contentType = options?.contentType || DEFAULT_CONTENT_TYPE

  await env.RAW_BUCKET.put(r2Key, compressed, {
    httpMetadata: { contentType },
  })

  await addAdminDownloadArtifact(db, {
    artifactId,
    jobId: job.job_id,
    artifactKind,
    fileName: options?.fileName || defaultArtifactFileName(job, artifactKind),
    contentType,
    rowCount,
    byteSize: compressed.byteLength,
    cursorStart,
    cursorEnd,
    r2Key,
  })
}
