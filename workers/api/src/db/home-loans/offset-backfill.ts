import { rebuildAnalyticsProjections } from '../analytics/rebuild'
import { loadCdrDetailPayloadMap } from '../cdr-detail-payloads'
import { detectExplicitOffsetAccountValue } from '../../ingest/cdr/mortgage-offset'
import { isRecord } from '../../ingest/cdr/primitives'

type HashCandidateRow = {
  cdr_product_detail_hash: string
  row_count: number
}

export async function backfillHomeLoanOffsetAccounts(
  db: D1Database,
  input?: { limitHashes?: number; rebuildProjections?: boolean },
): Promise<{ scanned_hashes: number; updated_rows: number; unresolved_rows: number; rebuilt_projections: boolean }> {
  const limitHashes = Math.max(1, Math.min(5000, Math.floor(Number(input?.limitHashes ?? 250))))
  const result = await db
    .prepare(
      `SELECT cdr_product_detail_hash, COUNT(*) AS row_count
       FROM historical_loan_rates
       WHERE has_offset_account IS NULL
         AND cdr_product_detail_hash IS NOT NULL
         AND TRIM(cdr_product_detail_hash) != ''
       GROUP BY cdr_product_detail_hash
       ORDER BY MIN(collection_date) ASC, cdr_product_detail_hash ASC
       LIMIT ?1`,
    )
    .bind(limitHashes)
    .all<HashCandidateRow>()

  const candidates = result.results ?? []
  const payloadMap = await loadCdrDetailPayloadMap(
    db,
    candidates.map((row) => String(row.cdr_product_detail_hash || '')),
  )

  let updatedRows = 0
  let unresolvedRows = 0
  for (const candidate of candidates) {
    const hash = String(candidate.cdr_product_detail_hash || '').trim()
    const payload = payloadMap.get(hash)
    if (!payload) {
      unresolvedRows += Number(candidate.row_count ?? 0)
      continue
    }

    let offsetValue: boolean | null = null
    try {
      const parsed = JSON.parse(payload)
      offsetValue = isRecord(parsed) ? detectExplicitOffsetAccountValue(parsed) : null
    } catch {
      offsetValue = null
    }

    if (offsetValue == null) {
      unresolvedRows += Number(candidate.row_count ?? 0)
      continue
    }

    await db
      .prepare(
        `UPDATE historical_loan_rates
         SET has_offset_account = ?1
         WHERE has_offset_account IS NULL
           AND cdr_product_detail_hash = ?2`,
      )
      .bind(offsetValue ? 1 : 0, hash)
      .run()

    await db
      .prepare(
        `UPDATE latest_home_loan_series
         SET has_offset_account = ?1
         WHERE has_offset_account IS NULL
           AND cdr_product_detail_hash = ?2`,
      )
      .bind(offsetValue ? 1 : 0, hash)
      .run()

    updatedRows += Number(candidate.row_count ?? 0)
  }

  const rebuildProjections = input?.rebuildProjections !== false
  if (rebuildProjections && updatedRows > 0) {
    await rebuildAnalyticsProjections(db, {
      dataset: 'home_loans',
      resume: false,
    })
  }

  return {
    scanned_hashes: candidates.length,
    updated_rows: updatedRows,
    unresolved_rows: unresolvedRows,
    rebuilt_projections: rebuildProjections && updatedRows > 0,
  }
}
