import type { EnvBindings } from '../types'
import { buildRawR2Key } from '../utils/idempotency'

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
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit || 500)))
  const rawPayloadResult = await db
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
    .bind(safeLimit)
    .all<LegacyRawPayloadCandidate>()

  const fetchEventResult = await db
    .prepare(
      `SELECT
         fe.content_hash,
         MAX(fe.source_type) AS source_type,
         MAX(fe.source_url) AS source_url,
         MIN(fe.fetched_at) AS fetched_at
       FROM fetch_events fe
       LEFT JOIN raw_objects ro
         ON ro.content_hash = fe.content_hash
       WHERE fe.raw_object_created = 1
         AND fe.content_hash IS NOT NULL
         AND TRIM(fe.content_hash) != ''
         AND ro.content_hash IS NULL
       GROUP BY fe.content_hash
       ORDER BY MIN(fe.fetched_at) ASC
       LIMIT ?1`,
    )
    .bind(safeLimit)
    .all<{ content_hash: string; source_type: string; source_url: string; fetched_at: string }>()

  const merged = new Map<string, LegacyRawPayloadCandidate>()
  for (const candidate of rawPayloadResult.results ?? []) {
    merged.set(candidate.content_hash, candidate)
  }
  for (const row of fetchEventResult.results ?? []) {
    const contentHash = String(row.content_hash || '').trim()
    if (!contentHash || merged.has(contentHash)) continue
    const sourceType = String(row.source_type || '').trim() || 'wayback_html'
    const sourceUrl = String(row.source_url || '').trim() || `rehydrate://${contentHash}`
    const fetchedAt = String(row.fetched_at || '').trim() || new Date().toISOString()
    merged.set(contentHash, {
      content_hash: contentHash,
      source_type: sourceType,
      source_url: sourceUrl,
      r2_key: buildRawR2Key(sourceType, fetchedAt, contentHash),
      fetched_at: fetchedAt,
    })
  }

  return Array.from(merged.values()).slice(0, safeLimit)
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
