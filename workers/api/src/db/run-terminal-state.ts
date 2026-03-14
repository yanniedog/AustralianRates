export type SummaryTotals = {
  enqueuedTotal: number
  processedTotal: number
  failedTotal: number
}

export type RunInvariantSummary = {
  dataset_rows: number
  lineage_error_rows: number
  zero_write_problem_rows: number
  successful_zero_product_rows: number
  problematic_rows: number
}

export function deriveTerminalRunStatus(
  totals: SummaryTotals,
  invariantSummary?: Pick<RunInvariantSummary, 'problematic_rows'>,
): 'ok' | 'partial' {
  const completedTotal = totals.processedTotal + totals.failedTotal
  if (totals.enqueuedTotal <= 0 || completedTotal < totals.enqueuedTotal) {
    return 'partial'
  }
  if (totals.failedTotal > 0) {
    return 'partial'
  }
  if ((invariantSummary?.problematic_rows ?? 0) > 0) {
    return 'partial'
  }
  return 'ok'
}

export async function loadRunInvariantSummary(db: D1Database, runId: string): Promise<RunInvariantSummary> {
  try {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*) AS dataset_rows,
           SUM(CASE WHEN COALESCE(lineage_error_count, 0) > 0 THEN 1 ELSE 0 END) AS lineage_error_rows,
           SUM(
             CASE
               WHEN COALESCE(index_fetch_succeeded, 0) = 0
                 OR COALESCE(failed_detail_count, 0) > 0
                 OR COALESCE(lineage_error_count, 0) > 0
                 OR (
                   COALESCE(written_row_count, 0) = 0
                   AND COALESCE(expected_detail_count, 0) > 0
                 )
               THEN 1 ELSE 0
             END
           ) AS zero_write_problem_rows,
           SUM(
             CASE
               WHEN COALESCE(index_fetch_succeeded, 0) = 1
                AND COALESCE(expected_detail_count, 0) = 0
                AND COALESCE(lineage_error_count, 0) = 0
                AND COALESCE(failed_detail_count, 0) = 0
               THEN 1 ELSE 0
             END
           ) AS successful_zero_product_rows,
           SUM(
             CASE
               WHEN COALESCE(index_fetch_succeeded, 0) = 0
                 OR COALESCE(failed_detail_count, 0) > 0
                 OR COALESCE(lineage_error_count, 0) > 0
                 OR (
                   COALESCE(written_row_count, 0) = 0
                   AND COALESCE(expected_detail_count, 0) > 0
                 )
               THEN 1 ELSE 0
             END
           ) AS problematic_rows
         FROM lender_dataset_runs
         WHERE run_id = ?1`,
      )
      .bind(runId)
      .first<Record<string, unknown>>()

    return {
      dataset_rows: Number(row?.dataset_rows ?? 0),
      lineage_error_rows: Number(row?.lineage_error_rows ?? 0),
      zero_write_problem_rows: Number(row?.zero_write_problem_rows ?? 0),
      successful_zero_product_rows: Number(row?.successful_zero_product_rows ?? 0),
      problematic_rows: Number(row?.problematic_rows ?? 0),
    }
  } catch {
    return {
      dataset_rows: 0,
      lineage_error_rows: 0,
      zero_write_problem_rows: 0,
      successful_zero_product_rows: 0,
      problematic_rows: 0,
    }
  }
}
