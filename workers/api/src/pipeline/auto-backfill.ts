import { TARGET_LENDERS } from '../constants'
import {
  claimAutoBackfillDate,
  ensureAutoBackfillProgressRow,
  listAutoBackfillProgress,
  type AutoBackfillProgressRow,
} from '../db/auto-backfill-progress'
import { enqueueBackfillDayJobs } from '../queue/producer'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { parseIntegerEnv } from '../utils/time'

type BackfillCandidate = {
  lenderCode: string
  collectionDate: string
  emptyStreak: number
}

function asActiveCandidate(
  lenderCode: string,
  row: AutoBackfillProgressRow | undefined,
  defaultDate: string,
): BackfillCandidate | null {
  if (!row) {
    return { lenderCode, collectionDate: defaultDate, emptyStreak: 0 }
  }
  if (row.status !== 'active') return null
  if (row.last_run_id) return null
  return {
    lenderCode,
    collectionDate: row.next_collection_date,
    emptyStreak: Number(row.empty_streak || 0),
  }
}

function byCoveragePriority(a: BackfillCandidate, b: BackfillCandidate): number {
  if (a.collectionDate > b.collectionDate) return -1
  if (a.collectionDate < b.collectionDate) return 1
  if (a.emptyStreak !== b.emptyStreak) return a.emptyStreak - b.emptyStreak
  return a.lenderCode.localeCompare(b.lenderCode)
}

export async function runAutoBackfillTick(
  env: EnvBindings,
  input: { runId: string; collectionDate: string },
): Promise<{ ok: boolean; enqueued: number; cap: number; considered: number }> {
  const enabled = String(env.FEATURE_BACKFILL_ENABLED || 'true').toLowerCase() !== 'false'
  if (!enabled) return { ok: true, enqueued: 0, cap: 0, considered: 0 }

  const lenderCodes = TARGET_LENDERS.map((x) => x.code)
  for (const lenderCode of lenderCodes) {
    await ensureAutoBackfillProgressRow(env.DB, lenderCode, input.collectionDate)
  }

  const progressMap = await listAutoBackfillProgress(env.DB, lenderCodes)
  const candidates = lenderCodes
    .map((lenderCode) => asActiveCandidate(lenderCode, progressMap[lenderCode], input.collectionDate))
    .filter((x): x is BackfillCandidate => Boolean(x))
    .sort(byCoveragePriority)

  const configuredCap = parseIntegerEnv(env.AUTO_BACKFILL_DAILY_QUEUE_CAP, TARGET_LENDERS.length)
  const cap = Math.max(1, Math.min(500, configuredCap))
  const jobs: Array<{ lenderCode: string; collectionDate: string }> = []

  for (const candidate of candidates) {
    if (jobs.length >= cap) break
    const claimed = await claimAutoBackfillDate(env.DB, {
      lenderCode: candidate.lenderCode,
      runId: input.runId,
      collectionDate: candidate.collectionDate,
    })
    if (!claimed) continue
    jobs.push({
      lenderCode: candidate.lenderCode,
      collectionDate: candidate.collectionDate,
    })
  }

  if (jobs.length === 0) {
    return { ok: true, enqueued: 0, cap, considered: candidates.length }
  }

  const enqueue = await enqueueBackfillDayJobs(env, {
    runId: input.runId,
    runSource: 'scheduled',
    jobs,
  })

  log.info('pipeline', `Auto backfill enqueued ${enqueue.enqueued} day jobs (cap=${cap})`, {
    runId: input.runId,
    context: `considered=${candidates.length}`,
  })

  return {
    ok: true,
    enqueued: enqueue.enqueued,
    cap,
    considered: candidates.length,
  }
}
