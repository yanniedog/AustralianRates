import type { DatasetKind } from '../../../../packages/shared/src'

type CoverageRow = {
  lender_code: string
  bank_name: string
  collection_date: string
  expected_detail_count: number
  completed_detail_count: number
  failed_detail_count: number
  finalized_at: string | null
  updated_at: string
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? []
}

export async function getLenderDatasetCoverage(
  db: D1Database,
  dataset: DatasetKind,
  input: { lenderCode?: string; collectionDate?: string; limit?: number } = {},
) {
  const where = ['dataset_kind = ?']
  const binds: Array<string | number> = [dataset]
  if (input.lenderCode) {
    where.push('lender_code = ?')
    binds.push(input.lenderCode)
  }
  if (input.collectionDate) {
    where.push('collection_date = ?')
    binds.push(input.collectionDate)
  }
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(input.limit) || 200)))
  binds.push(limit)

  const sql = `
    SELECT
      lender_code,
      bank_name,
      collection_date,
      expected_detail_count,
      completed_detail_count,
      failed_detail_count,
      finalized_at,
      updated_at
    FROM lender_dataset_runs
    WHERE ${where.join(' AND ')}
    ORDER BY collection_date DESC, lender_code ASC
    LIMIT ?
  `

  const result = await db.prepare(sql).bind(...binds).all<CoverageRow>()
  const coverage = rows(result).map((row) => {
    const expected = Number(row.expected_detail_count || 0)
    const completed = Number(row.completed_detail_count || 0)
    const failed = Number(row.failed_detail_count || 0)
    const processed = completed + failed
    return {
      lender_code: row.lender_code,
      bank_name: row.bank_name,
      collection_date: row.collection_date,
      expected_detail_count: expected,
      completed_detail_count: completed,
      failed_detail_count: failed,
      pending_detail_count: Math.max(0, expected - processed),
      finalized_at: row.finalized_at,
      updated_at: row.updated_at,
      completeness_ratio: expected > 0 ? Number((processed / expected).toFixed(4)) : 1,
    }
  })

  return {
    dataset,
    count: coverage.length,
    rows: coverage,
  }
}
