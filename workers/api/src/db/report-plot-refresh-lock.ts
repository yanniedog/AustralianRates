import { nowIso } from '../utils/time'

const REPORT_PLOT_REFRESH_LOCK_TABLE = 'report_plot_refresh_locks'
const REPORT_PLOT_REFRESH_LOCK_LEASE_MS = 20_000
const REPORT_PLOT_REFRESH_LOCK_POLL_MS = 100
const REPORT_PLOT_REFRESH_LOCK_WAIT_MS = 20_000

type ReportPlotSection = 'home_loans' | 'savings' | 'term_deposits'

type LockRow = {
  owner_id: string
  lease_expires_at: string
}

function lockExpiryIso(): string {
  return new Date(Date.now() + REPORT_PLOT_REFRESH_LOCK_LEASE_MS).toISOString()
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function hasRows(db: D1Database, table: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).first<{ ok: number }>()
  return Number(row?.ok || 0) === 1
}

async function tryAcquireRefreshLock(
  db: D1Database,
  section: ReportPlotSection,
  ownerId: string,
): Promise<boolean> {
  const now = nowIso()
  const leaseExpiresAt = lockExpiryIso()
  const result = await db
    .prepare(
      `INSERT INTO ${REPORT_PLOT_REFRESH_LOCK_TABLE} (
         section,
         owner_id,
         lease_expires_at,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(section) DO UPDATE SET
         owner_id = excluded.owner_id,
         lease_expires_at = excluded.lease_expires_at,
         updated_at = excluded.updated_at
       WHERE ${REPORT_PLOT_REFRESH_LOCK_TABLE}.lease_expires_at IS NULL
          OR ${REPORT_PLOT_REFRESH_LOCK_TABLE}.lease_expires_at <= excluded.updated_at
          OR ${REPORT_PLOT_REFRESH_LOCK_TABLE}.owner_id = excluded.owner_id`,
    )
    .bind(section, ownerId, leaseExpiresAt, now)
    .run()
  return Number(result.meta?.changes ?? 0) > 0
}

async function releaseRefreshLock(
  db: D1Database,
  section: ReportPlotSection,
  ownerId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM ${REPORT_PLOT_REFRESH_LOCK_TABLE}
       WHERE section = ?1
         AND owner_id = ?2`,
    )
    .bind(section, ownerId)
    .run()
}

export async function withReportPlotRefreshLock<T>(
  db: D1Database,
  input: {
    section: ReportPlotSection
    table: string
    ownerId?: string
    task: () => Promise<T>
  },
): Promise<T | null> {
  const ownerId = input.ownerId || crypto.randomUUID()
  const deadline = Date.now() + REPORT_PLOT_REFRESH_LOCK_WAIT_MS

  while (Date.now() <= deadline) {
    if (await tryAcquireRefreshLock(db, input.section, ownerId)) {
      try {
        return await input.task()
      } finally {
        await releaseRefreshLock(db, input.section, ownerId)
      }
    }
    if (await hasRows(db, input.table)) return null
    await sleep(REPORT_PLOT_REFRESH_LOCK_POLL_MS)
  }

  throw new Error(`report_plot_refresh_lock_timeout:${input.section}`)
}
