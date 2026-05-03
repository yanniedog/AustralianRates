import {
  DEFAULT_LOCK_TTL_SECONDS,
  MELBOURNE_TIMEZONE,
  TARGET_LENDERS,
} from '../constants'
import { refreshEndpointCache } from '../db/endpoint-cache'
import {
  buildInitialPerLenderSummary,
  createRunReport,
  hasRunningDailyRunForCollectionDate,
  markRunFailed,
  setRunEnqueuedSummary,
} from '../db/run-reports'
import { getCompletedLenderCodesForDailyCollection } from '../db/lender-dataset-status'
import { backfillRbaCashRatesForDateRange } from '../ingest/rba'
import { collectCpiFromRbaG1 } from '../ingest/cpi'
import { acquireRunLock, releaseRunLock } from '../durable/run-lock'
import { enqueueBackfillJobs, enqueueDailyLenderJobs, enqueueDailySavingsLenderJobs } from '../queue/producer'
import type { EnvBindings, LenderConfig } from '../types'
import { buildBackfillRunId, buildDailyRunId, buildRunLockKey } from '../utils/idempotency'
import { log } from '../utils/logger'
import { isD1EmergencyMinimumWrites } from '../utils/d1-emergency'
import { currentMonthCursor, getMelbourneNowParts, parseIntegerEnv } from '../utils/time'
import type { DatasetKind } from '../../../../packages/shared/src'

type DailyRunOptions = {
  source: 'scheduled' | 'manual'
  force?: boolean
  /** When set, use this as runId (e.g. for interval-based runs so each run is unique). */
  runIdOverride?: string
  collectionDateOverride?: string
  lenderCodes?: string[]
  datasets?: DatasetKind[]
}

type BackfillRunRequest = {
  lenderCodes?: string[]
  monthCursor?: string
  maxSnapshotsPerMonth?: number
}

function filterLenders(codes?: string[]): LenderConfig[] {
  if (!codes || codes.length === 0) {
    return TARGET_LENDERS
  }
  const selected = new Set(codes.map((code) => code.toLowerCase().trim()))
  return TARGET_LENDERS.filter((lender) => selected.has(lender.code.toLowerCase()))
}

function mergePerLenderCounts(
  primary: Record<string, number>,
  secondary: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...primary }
  for (const [code, count] of Object.entries(secondary)) {
    merged[code] = (merged[code] || 0) + count
  }
  return merged
}

export function pendingSavingsTdLenders(
  lenders: LenderConfig[],
  completedSavings: ReadonlySet<string>,
  completedTd: ReadonlySet<string>,
): LenderConfig[] {
  return lenders.filter((lender) => !completedSavings.has(lender.code) || !completedTd.has(lender.code))
}

export type DailyDatasetSelection = {
  homeLoans: boolean
  savings: boolean
  termDeposits: boolean
}

function normalizeDailyDatasetSelection(datasets?: DatasetKind[]): DailyDatasetSelection {
  const selected = new Set((datasets ?? []).filter(Boolean))
  if (selected.size === 0) {
    return {
      homeLoans: true,
      savings: true,
      termDeposits: true,
    }
  }
  return {
    homeLoans: selected.has('home_loans'),
    savings: selected.has('savings'),
    termDeposits: selected.has('term_deposits'),
  }
}

function pendingSelectedLenders(
  lenders: LenderConfig[],
  completed: ReadonlySet<string>,
  force: boolean,
): LenderConfig[] {
  if (force) return lenders
  return lenders.filter((lender) => !completed.has(lender.code))
}

function pendingSelectedSavingsTdLenders(
  lenders: LenderConfig[],
  completedSavings: ReadonlySet<string>,
  completedTd: ReadonlySet<string>,
  selection: DailyDatasetSelection,
  force: boolean,
): LenderConfig[] {
  if (force) return lenders
  return lenders.filter((lender) => {
    const savingsPending = selection.savings && !completedSavings.has(lender.code)
    const tdPending = selection.termDeposits && !completedTd.has(lender.code)
    return savingsPending || tdPending
  })
}

function isMonthCursor(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value)
}

async function historicalRowCountForCollectionDate(
  db: D1Database,
  table: 'historical_loan_rates' | 'historical_savings_rates' | 'historical_term_deposit_rates',
  collectionDate: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE collection_date = ?`)
    .bind(collectionDate)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

/**
 * Scheduled runs can mark every lender_dataset_run as "complete" (e.g. zero expected TD details) while
 * the historical table still has no rows for that collection_date. Post-ingest assurance then fails.
 * When no savings/TD lenders are pending but counts are zero, re-pick all lenders with force and
 * enqueue only the datasets that are still empty.
 */
export function planSavingsTdEnqueueDatasets(input: {
  selection: DailyDatasetSelection
  pendingSavingsLendersCount: number
  historicalSavingsCount: number
  historicalTdCount: number
}): { repickAllSavingsLendersWithForce: boolean; datasets: Array<'savings' | 'term_deposits'> } {
  const full: Array<'savings' | 'term_deposits'> = [
    ...(input.selection.savings ? ['savings' as const] : []),
    ...(input.selection.termDeposits ? ['term_deposits' as const] : []),
  ]
  if (input.pendingSavingsLendersCount > 0) {
    return { repickAllSavingsLendersWithForce: false, datasets: full }
  }
  const needSavings = input.selection.savings && input.historicalSavingsCount === 0
  const needTd = input.selection.termDeposits && input.historicalTdCount === 0
  if (!needSavings && !needTd) {
    return { repickAllSavingsLendersWithForce: false, datasets: full }
  }
  return {
    repickAllSavingsLendersWithForce: true,
    datasets: [
      ...(needSavings ? ['savings' as const] : []),
      ...(needTd ? ['term_deposits' as const] : []),
    ],
  }
}

export async function triggerDailyRun(env: EnvBindings, options: DailyRunOptions) {
  const melbourneParts = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
  const collectionDate = options.collectionDateOverride || melbourneParts.date
  const baseRunId = buildDailyRunId(collectionDate)
  const runId =
    options.runIdOverride ??
    (options.force ? `${baseRunId}:force:${crypto.randomUUID()}` : baseRunId)

  const lockKey = buildRunLockKey('daily', collectionDate)
  const lockTtlSeconds = parseIntegerEnv(env.LOCK_TTL_SECONDS, DEFAULT_LOCK_TTL_SECONDS)

  let lockAcquired = false
  try {
    const selectedLenders = filterLenders(options.lenderCodes)
    const datasetSelection = normalizeDailyDatasetSelection(options.datasets)

    if (!options.force) {
      const lock = await acquireRunLock(env, {
        key: lockKey,
        owner: runId,
        ttlSeconds: lockTtlSeconds,
      })

      if (!lock.ok) {
        return {
          ok: false,
          skipped: true,
          reason: lock.reason || 'lock_unavailable',
          runId,
          collectionDate,
        }
      }

      if (!lock.acquired) {
        return {
          ok: true,
          skipped: true,
          reason: 'daily_run_locked',
          runId,
          collectionDate,
        }
      }

      lockAcquired = true
    }

    const [doneLoans, doneSavings, doneTd] = await Promise.all([
      getCompletedLenderCodesForDailyCollection(env.DB, {
        collectionDate,
        dataset: 'home_loans',
        runSource: options.source,
      }),
      getCompletedLenderCodesForDailyCollection(env.DB, {
        collectionDate,
        dataset: 'savings',
        runSource: options.source,
      }),
      getCompletedLenderCodesForDailyCollection(env.DB, {
        collectionDate,
        dataset: 'term_deposits',
        runSource: options.source,
      }),
    ])
    let pendingLoanLenders = datasetSelection.homeLoans
      ? pendingSelectedLenders(selectedLenders, doneLoans, Boolean(options.force))
      : []
    let pendingSavingsLenders = datasetSelection.savings || datasetSelection.termDeposits
      ? pendingSelectedSavingsTdLenders(
          selectedLenders,
          doneSavings,
          doneTd,
          datasetSelection,
          Boolean(options.force),
        )
      : []

    let savingsEnqueueDatasets: Array<'savings' | 'term_deposits'> = [
      ...(datasetSelection.savings ? ['savings' as const] : []),
      ...(datasetSelection.termDeposits ? ['term_deposits' as const] : []),
    ]

    if (pendingLoanLenders.length === 0 && datasetSelection.homeLoans) {
      const loanRows = await historicalRowCountForCollectionDate(env.DB, 'historical_loan_rates', collectionDate)
      if (loanRows === 0) {
        pendingLoanLenders = pendingSelectedLenders(selectedLenders, doneLoans, true)
      }
    }

    if (pendingSavingsLenders.length === 0 && (datasetSelection.savings || datasetSelection.termDeposits)) {
      const histSavings = datasetSelection.savings
        ? await historicalRowCountForCollectionDate(env.DB, 'historical_savings_rates', collectionDate)
        : -1
      const histTd = datasetSelection.termDeposits
        ? await historicalRowCountForCollectionDate(env.DB, 'historical_term_deposit_rates', collectionDate)
        : -1
      const plan = planSavingsTdEnqueueDatasets({
        selection: datasetSelection,
        pendingSavingsLendersCount: 0,
        historicalSavingsCount: histSavings,
        historicalTdCount: histTd,
      })
      if (plan.repickAllSavingsLendersWithForce) {
        pendingSavingsLenders = pendingSelectedSavingsTdLenders(
          selectedLenders,
          new Set(),
          new Set(),
          {
            homeLoans: false,
            savings: plan.datasets.includes('savings'),
            termDeposits: plan.datasets.includes('term_deposits'),
          },
          true,
        )
      }
      savingsEnqueueDatasets = plan.datasets
    }

    if (pendingLoanLenders.length === 0 && pendingSavingsLenders.length === 0) {
      if (!isD1EmergencyMinimumWrites(env)) {
        const sevenDaysAgo = new Date(new Date(collectionDate).getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        await Promise.all([
          backfillRbaCashRatesForDateRange(env.DB, sevenDaysAgo, collectionDate, env),
          collectCpiFromRbaG1(env.DB, env),
        ])
      }
      return {
        ok: true,
        skipped: true,
        reason: 'already_fresh_for_date',
        runId,
        collectionDate,
        pending: { loans: 0, savings_td: 0 },
        selection: {
          lender_codes: selectedLenders.map((lender) => lender.code),
          datasets: options.datasets ?? ['home_loans', 'savings', 'term_deposits'],
        },
      }
    }

    if (options.source === 'scheduled' && !options.force) {
      const hasRunningForDate = await hasRunningDailyRunForCollectionDate(env.DB, collectionDate)
      if (hasRunningForDate) {
        return {
          ok: true,
          skipped: true,
          reason: 'existing_run_in_progress_for_date',
          runId,
          collectionDate,
        }
      }
    }

    const created = await createRunReport(env.DB, {
      runId,
      runType: 'daily',
      runSource: options.source,
    })

    if (!created.created && !options.force) {
      return {
        ok: true,
        skipped: true,
        reason: 'run_already_exists',
        runId,
        collectionDate,
      }
    }

    try {
      log.info('pipeline', `Daily run ${runId} starting: collecting RBA/CPI data and refreshing endpoints`, { runId })
      const sevenDaysAgo = new Date(new Date(collectionDate).getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const emergencyMinimumWrites = isD1EmergencyMinimumWrites(env)
      const [rbaCollection] = emergencyMinimumWrites
        ? [{ ok: true, upserted: 0, skipped: 0, startDate: sevenDaysAgo, endDate: collectionDate, sourceUrl: '', message: 'skipped_emergency_minimum_writes' }]
        : await Promise.all([
            backfillRbaCashRatesForDateRange(env.DB, sevenDaysAgo, collectionDate, env),
            collectCpiFromRbaG1(env.DB, env),
          ])
      const endpointRefresh = emergencyMinimumWrites
        ? { refreshed: 0, failed: 0, skipped: TARGET_LENDERS.length, errors: [] }
        : await refreshEndpointCache(env.DB, TARGET_LENDERS, 24, env)

      const enqueue = await enqueueDailyLenderJobs(env, {
        runId,
        runSource: options.source,
        collectionDate,
        lenders: pendingLoanLenders,
      })

      const savingsEnqueue = await enqueueDailySavingsLenderJobs(env, {
        runId,
        runSource: options.source,
        collectionDate,
        lenders: pendingSavingsLenders,
        datasets: savingsEnqueueDatasets,
      })

      const summary = buildInitialPerLenderSummary(mergePerLenderCounts(enqueue.perLender, savingsEnqueue.perLender))
      await setRunEnqueuedSummary(env.DB, runId, summary)
      const totalEnqueued = enqueue.enqueued + savingsEnqueue.enqueued
      log.info('pipeline', `Daily run ${runId} enqueued ${totalEnqueued} jobs (${enqueue.enqueued} loan + ${savingsEnqueue.enqueued} savings/td) for ${collectionDate}`, { runId })

      return {
        ok: true,
        skipped: false,
        runId,
        collectionDate,
        enqueued: totalEnqueued,
        selection: {
          lender_codes: selectedLenders.map((lender) => lender.code),
          datasets: options.datasets ?? ['home_loans', 'savings', 'term_deposits'],
        },
        endpoint_refresh: endpointRefresh,
        rba_collection: rbaCollection,
        source: options.source,
      }
    } catch (error) {
      log.error('pipeline', `Daily run ${runId} failed: ${(error as Error)?.message || String(error)}`, {
        code: 'daily_run_failed',
        runId,
      })
      await markRunFailed(env.DB, runId, `daily_run_enqueue_failed: ${(error as Error)?.message || String(error)}`)
      throw error
    }
  } finally {
    if (lockAcquired) {
      try {
        await releaseRunLock(env, { key: lockKey, owner: runId })
      } catch (error) {
        log.error('pipeline', `Daily run ${runId} lock release failed: ${(error as Error)?.message || String(error)}`, {
          code: 'daily_run_lock_release_failed',
          runId,
        })
      }
    }
  }
}

export async function triggerBackfillRun(env: EnvBindings, input: BackfillRunRequest) {
  const melbourneParts = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
  const monthCursor = isMonthCursor(input.monthCursor) ? input.monthCursor : currentMonthCursor(melbourneParts)
  const maxSnapshotsPerMonth = Math.min(3, Math.max(1, Number(input.maxSnapshotsPerMonth) || 3))

  const lenders = filterLenders(input.lenderCodes)
  const runId = buildBackfillRunId(monthCursor)

  await createRunReport(env.DB, {
    runId,
    runType: 'backfill',
    runSource: 'manual',
  })

  const jobs: Array<{ lenderCode: string; seedUrl: string; monthCursor: string }> = []
  for (const lender of lenders) {
    for (const seedUrl of lender.seed_rate_urls.slice(0, maxSnapshotsPerMonth)) {
      jobs.push({
        lenderCode: lender.code,
        seedUrl,
        monthCursor,
      })
    }
  }

  try {
    log.info('pipeline', `Backfill run ${runId} starting for month=${monthCursor} lenders=${lenders.length}`, { runId })
    const enqueue = await enqueueBackfillJobs(env, {
      runId,
      runSource: 'manual',
      jobs,
    })

    await setRunEnqueuedSummary(env.DB, runId, buildInitialPerLenderSummary(enqueue.perLender))
    log.info('pipeline', `Backfill run ${runId} enqueued ${enqueue.enqueued} jobs`, { runId })

    return {
      ok: true,
      runId,
      monthCursor,
      selectedLenders: lenders.map((l) => l.code),
      maxSnapshotsPerMonth,
      enqueued: enqueue.enqueued,
    }
  } catch (error) {
    log.error('pipeline', `Backfill run ${runId} failed: ${(error as Error)?.message || String(error)}`, {
      code: 'backfill_run_failed',
      runId,
    })
    await markRunFailed(env.DB, runId, `backfill_enqueue_failed: ${(error as Error)?.message || String(error)}`)
    throw error
  }
}
