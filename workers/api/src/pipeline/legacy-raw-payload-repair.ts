import type { EnvBindings } from '../types'

type LegacyRawPayloadCandidate = {
  content_hash: string
  source_type: string
  source_url: string
  r2_key: string
  fetched_at: string
}

export type LegacyRawPayloadRepairResult = {
  scanned_rows: number
  repaired_rows: number
  missing_object_rows: number
  dry_run: boolean
}

function inferContentType(sourceType: string): string {
  return sourceType === 'wayback_html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
}

async function loadCandidates(db: D1Database, limit: number): Promise<LegacyRawPayloadCandidate[]> {
  const result = await db
    .prepare(
      `SELECT
         rp.content_hash,
         MAX(rp.source_type) AS source_type,
         MAX(rp.source_url) AS source_url,
         MAX(rp.r2_key) AS r2_key,
         MIN(rp.fetched_at) AS fetched_at
       FROM raw_payloads rp
       LEFT JOIN raw_objects ro
         ON ro.content_hash = rp.content_hash
       WHERE ro.content_hash IS NULL
       GROUP BY rp.content_hash
       ORDER BY MIN(rp.fetched_at) ASC
       LIMIT ?1`,
    )
    .bind(Math.max(1, Math.min(5000, Math.floor(limit || 500))))
    .all<LegacyRawPayloadCandidate>()

  return result.results ?? []
}

export async function repairLegacyRawPayloadLinkage(
  env: Pick<EnvBindings, 'DB' | 'RAW_BUCKET'>,
  input?: { limit?: number; dryRun?: boolean },
): Promise<LegacyRawPayloadRepairResult> {
  const dryRun = Boolean(input?.dryRun)
  const candidates = await loadCandidates(env.DB, Number(input?.limit ?? 500))
  let repairedRows = 0
  let missingObjectRows = 0

  for (const candidate of candidates) {
    const object = await env.RAW_BUCKET.head(candidate.r2_key)
    if (!object) {
      missingObjectRows += 1
      continue
    }
    if (dryRun) {
      repairedRows += 1
      continue
    }

    const result = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO raw_objects (
           content_hash,
           source_type,
           first_source_url,
           body_bytes,
           content_type,
           r2_key,
           created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        candidate.content_hash,
        candidate.source_type,
        candidate.source_url,
        Number(object.size ?? 0),
        object.httpMetadata?.contentType || inferContentType(candidate.source_type),
        candidate.r2_key,
        candidate.fetched_at,
      )
      .run()
    repairedRows += Number(result.meta?.changes ?? 0)
  }

  return {
    scanned_rows: candidates.length,
    repaired_rows: repairedRows,
    missing_object_rows: missingObjectRows,
    dry_run: dryRun,
  }
}
