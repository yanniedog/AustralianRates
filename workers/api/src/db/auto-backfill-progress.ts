import { nowIso } from '../utils/time'

export type AutoBackfillProgressRow = {
  lender_code: string
  next_collection_date: string
  empty_streak: number
  status: 'active' | 'completed_full_history'
  updated_at: string
  last_run_id: string | null
}

const MIN_BACKFILL_DATE = '1996-01-01'
const COMPLETE_AFTER_EMPTY_DAYS = 365

function parseDateOnly(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const d = new Date(`${date}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function previousDate(date: string): string {
  const parsed = parseDateOnly(date)
  if (!parsed) return date
  parsed.setUTCDate(parsed.getUTCDate() - 1)
  return parsed.toISOString().slice(0, 10)
}

export async function listAutoBackfillProgress(
  db: D1Database,
  lenderCodes: string[],
): Promise<Record<string, AutoBackfillProgressRow>> {
  if (lenderCodes.length === 0) return {}
  const placeholders = lenderCodes.map((_x, i) => `?${i + 1}`).join(', ')
  const result = await db
    .prepare(
      `SELECT lender_code, next_collection_date, empty_streak, status, updated_at, last_run_id
       FROM auto_backfill_progress
       WHERE lender_code IN (${placeholders})`,
    )
    .bind(...lenderCodes)
    .all<AutoBackfillProgressRow>()
  const out: Record<string, AutoBackfillProgressRow> = {}
  for (const row of result.results ?? []) out[row.lender_code] = row
  return out
}

export async function ensureAutoBackfillProgressRow(
  db: D1Database,
  lenderCode: string,
  startDate: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auto_backfill_progress (lender_code, next_collection_date, empty_streak, status, updated_at, last_run_id)
       VALUES (?1, ?2, 0, 'active', ?3, NULL)
       ON CONFLICT(lender_code) DO NOTHING`,
    )
    .bind(lenderCode, startDate, nowIso())
    .run()
}

export async function claimAutoBackfillDate(
  db: D1Database,
  input: { lenderCode: string; runId: string; collectionDate: string },
): Promise<boolean> {
  const claimed = await db
    .prepare(
      `UPDATE auto_backfill_progress
       SET last_run_id = ?1,
           updated_at = ?2
       WHERE lender_code = ?3
         AND status = 'active'
         AND next_collection_date = ?4
         AND (last_run_id IS NULL OR last_run_id = '')`,
    )
    .bind(input.runId, nowIso(), input.lenderCode, input.collectionDate)
    .run()
  return Number(claimed.meta?.changes ?? 0) > 0
}

export async function releaseAutoBackfillClaim(
  db: D1Database,
  input: { lenderCode: string; runId: string; collectionDate: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE auto_backfill_progress
       SET last_run_id = NULL,
           updated_at = ?1
       WHERE lender_code = ?2
         AND next_collection_date = ?3
         AND last_run_id = ?4`,
    )
    .bind(nowIso(), input.lenderCode, input.collectionDate, input.runId)
    .run()
}

export async function advanceAutoBackfillAfterDay(
  db: D1Database,
  input: {
    lenderCode: string
    runId: string
    collectionDate: string
    hadSignals: boolean
  },
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT lender_code, next_collection_date, empty_streak, status, updated_at, last_run_id
       FROM auto_backfill_progress
       WHERE lender_code = ?1`,
    )
    .bind(input.lenderCode)
    .first<AutoBackfillProgressRow>()
  if (!row) return
  if (row.status !== 'active') return
  if (row.last_run_id !== input.runId) return
  if (row.next_collection_date !== input.collectionDate) return

  const nextCollectionDate = previousDate(input.collectionDate)
  const emptyStreak = input.hadSignals ? 0 : Number(row.empty_streak || 0) + 1
  const status: AutoBackfillProgressRow['status'] =
    nextCollectionDate < MIN_BACKFILL_DATE || emptyStreak >= COMPLETE_AFTER_EMPTY_DAYS
      ? 'completed_full_history'
      : 'active'

  await db
    .prepare(
      `UPDATE auto_backfill_progress
       SET next_collection_date = ?1,
           empty_streak = ?2,
           status = ?3,
           updated_at = ?4,
           last_run_id = NULL
       WHERE lender_code = ?5`,
    )
    .bind(nextCollectionDate, emptyStreak, status, nowIso(), input.lenderCode)
    .run()
}
