import type { HistoricalRunStatus } from './types'

function asInt(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

export function toProgressPct(completed: number, failed: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(((completed + failed) / total) * 1000) / 10))
}

export function deriveRunStatus(counts: {
  total: number
  pending: number
  claimed: number
  completed: number
  failed: number
}): HistoricalRunStatus {
  if (counts.total <= 0) return 'failed'
  if (counts.pending > 0 || counts.claimed > 0) {
    return counts.claimed > 0 || counts.completed > 0 || counts.failed > 0 ? 'running' : 'pending'
  }
  if (counts.failed > 0 && counts.completed > 0) return 'partial'
  if (counts.failed > 0) return 'failed'
  return 'completed'
}

export async function getTaskCounters(db: D1Database, runId: string): Promise<{
  total: number
  pending: number
  claimed: number
  completed: number
  failed: number
  mortgageRows: number
  savingsRows: number
  tdRows: number
}> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(mortgage_rows) AS mortgage_rows,
         SUM(savings_rows) AS savings_rows,
         SUM(td_rows) AS td_rows
       FROM client_historical_tasks
       WHERE run_id = ?1`,
    )
    .bind(runId)
    .first<Record<string, unknown>>()

  return {
    total: asInt(row?.total),
    pending: asInt(row?.pending),
    claimed: asInt(row?.claimed),
    completed: asInt(row?.completed),
    failed: asInt(row?.failed),
    mortgageRows: asInt(row?.mortgage_rows),
    savingsRows: asInt(row?.savings_rows),
    tdRows: asInt(row?.td_rows),
  }
}
