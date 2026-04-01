import {
  computeHistoricalQualityDailySummary,
  mergeHistoricalQualityDailySummaries,
} from '../db/historical-quality-daily-summary'
import {
  attachHistoricalQualityDailySummary,
  readHistoricalQualityDailySummary,
} from '../db/historical-quality-daily-payload'
import {
  aggregateHistoricalQualityOverallRow,
  buildHistoricalQualityDailyRow,
  computeHistoricalQualityDatasetBatch,
  type HistoricalQualityCountsSnapshot,
  type HistoricalQualityFindingMetrics,
  type HistoricalQualityProvenanceSnapshot,
  type HistoricalQualityStructureSnapshot,
} from '../db/historical-quality-audit'
import {
  hasPermanentHistoricalQualityEvidence,
  listDatasetLenderCodesForDate,
  listHistoricalQualityDates,
  loadReferenceWindow,
  loadRunStateSnapshot,
  precheckDateScopeRowCount,
} from '../db/historical-quality-queries'
import { computeHistoricalQualityCutoffs } from '../db/historical-quality-summary'
import {
  createHistoricalQualityRun,
  getHistoricalQualityRun,
  listHistoricalQualityDailyByRun,
  listHistoricalQualityFindingsByRunDateScope,
  listHistoricalQualityFindingsByRun,
  listHistoricalQualityRuns,
  replaceHistoricalQualityFindings,
  restartHistoricalQualityRun,
  updateHistoricalQualityRun,
  upsertHistoricalQualityDaily,
  upsertHistoricalQualityFindings,
} from '../db/historical-quality-store'
import {
  HISTORICAL_QUALITY_DATASET_SCOPES,
  type HistoricalQualityDatasetScope,
  type HistoricalQualityRunRow,
  type HistoricalQualityRunStatus,
} from '../db/historical-quality-types'
import { nextHistoricalQualityLenderCursor, shouldSplitHistoricalQualityBatch } from './historical-quality-batching'
import type { EnvBindings } from '../types'

type HistoricalQualityFilters = { startDate?: string; endDate?: string }

type SplitAggregate = HistoricalQualityCountsSnapshot &
  HistoricalQualityStructureSnapshot &
  HistoricalQualityProvenanceSnapshot &
  HistoricalQualityFindingMetrics

type SplitState = {
  collection_date: string
  scope: HistoricalQualityDatasetScope
  lender_codes: string[]
  processed_lenders: string[]
  aggregate: SplitAggregate
}

type RunSummary = Record<string, unknown> & {
  cutoff_candidates?: unknown
  total_daily_rows?: number
  split_state?: SplitState
}

function parseFilters(raw: string): HistoricalQualityFilters {
  try {
    return JSON.parse(raw || '{}') as HistoricalQualityFilters
  } catch {
    return {}
  }
}

function parseSummary(raw: string): RunSummary {
  try {
    return JSON.parse(raw || '{}') as RunSummary
  } catch {
    return {}
  }
}

async function filteredDates(db: D1Database, startDate?: string, endDate?: string): Promise<string[]> {
  const dates = await listHistoricalQualityDates(db)
  return dates.filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
}

function nextScope(scope: string | null): HistoricalQualityDatasetScope | null {
  const index = HISTORICAL_QUALITY_DATASET_SCOPES.findIndex((candidate) => candidate === scope)
  if (index < 0) return HISTORICAL_QUALITY_DATASET_SCOPES[0]
  return HISTORICAL_QUALITY_DATASET_SCOPES[index + 1] ?? null
}

function emptySplitAggregate(): SplitAggregate {
  return {
    row_count: 0,
    bank_count: 0,
    product_count: 0,
    series_count: 0,
    active_series_count: 0,
    changed_series_count: 0,
    provenance_exact_count: 0,
    provenance_reconstructed_count: 0,
    provenance_legacy_count: 0,
    provenance_quarantined_count: 0,
    provenance_unclassified_count: 0,
    duplicate_rows: 0,
    missing_required_rows: 0,
    invalid_value_rows: 0,
    cross_table_conflict_rows: 0,
    explainedAppearances: 0,
    unexplainedAppearances: 0,
    explainedDisappearances: 0,
    unexplainedDisappearances: 0,
    weightedAffectedSeries: 0,
    weightedRateFlowFlags: 0,
  }
}

function accumulateSplitAggregate(
  aggregate: SplitAggregate,
  partial: {
    dailyRow: HistoricalQualityCountsSnapshot & HistoricalQualityStructureSnapshot & HistoricalQualityProvenanceSnapshot
    findings: HistoricalQualityFindingMetrics
  },
): SplitAggregate {
  return {
    row_count: aggregate.row_count + partial.dailyRow.row_count,
    bank_count: aggregate.bank_count + partial.dailyRow.bank_count,
    product_count: aggregate.product_count + partial.dailyRow.product_count,
    series_count: aggregate.series_count + partial.dailyRow.series_count,
    active_series_count: aggregate.active_series_count + partial.dailyRow.active_series_count,
    changed_series_count: aggregate.changed_series_count + partial.dailyRow.changed_series_count,
    provenance_exact_count: aggregate.provenance_exact_count + partial.dailyRow.provenance_exact_count,
    provenance_reconstructed_count: aggregate.provenance_reconstructed_count + partial.dailyRow.provenance_reconstructed_count,
    provenance_legacy_count: aggregate.provenance_legacy_count + partial.dailyRow.provenance_legacy_count,
    provenance_quarantined_count: aggregate.provenance_quarantined_count + partial.dailyRow.provenance_quarantined_count,
    provenance_unclassified_count: aggregate.provenance_unclassified_count + partial.dailyRow.provenance_unclassified_count,
    duplicate_rows: aggregate.duplicate_rows + partial.dailyRow.duplicate_rows,
    missing_required_rows: aggregate.missing_required_rows + partial.dailyRow.missing_required_rows,
    invalid_value_rows: aggregate.invalid_value_rows + partial.dailyRow.invalid_value_rows,
    cross_table_conflict_rows: aggregate.cross_table_conflict_rows + partial.dailyRow.cross_table_conflict_rows,
    explainedAppearances: aggregate.explainedAppearances + partial.findings.explainedAppearances,
    unexplainedAppearances: aggregate.unexplainedAppearances + partial.findings.unexplainedAppearances,
    explainedDisappearances: aggregate.explainedDisappearances + partial.findings.explainedDisappearances,
    unexplainedDisappearances: aggregate.unexplainedDisappearances + partial.findings.unexplainedDisappearances,
    weightedAffectedSeries: aggregate.weightedAffectedSeries + partial.findings.weightedAffectedSeries,
    weightedRateFlowFlags: aggregate.weightedRateFlowFlags + partial.findings.weightedRateFlowFlags,
  }
}

function shouldRetryAsSplit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|too many|result size|query size|statement too large|cpu/i.test(message)
}

async function finalizeHistoricalQualityRun(db: D1Database, auditRunId: string, summary: RunSummary): Promise<void> {
  const existingRows = await listHistoricalQualityDailyByRun(db, auditRunId)
  const rowsByDate = new Map<string, typeof existingRows>()
  for (const row of existingRows) {
    const bucket = rowsByDate.get(row.collection_date) ?? []
    bucket.push(row)
    rowsByDate.set(row.collection_date, bucket)
  }
  for (const [collectionDate, rowsForDate] of rowsByDate) {
    if (rowsForDate.some((row) => row.scope === 'overall')) continue
    const datasetRows = rowsForDate.filter((row) => row.scope !== 'overall')
    if (datasetRows.length === 0) continue
    await upsertHistoricalQualityDaily(db, aggregateHistoricalQualityOverallRow(auditRunId, collectionDate, datasetRows))
  }
  const rows = await listHistoricalQualityDailyByRun(db, auditRunId)
  const cutoffs = computeHistoricalQualityCutoffs(rows)
  await updateHistoricalQualityRun(db, auditRunId, {
    status: 'completed',
    summary: { ...summary, split_state: undefined, cutoff_candidates: cutoffs, total_daily_rows: rows.length },
    finished: true,
    nextCollectionDate: null,
    nextScope: null,
    lenderCursor: null,
    mode: 'whole_date_scope',
  })
}

function previousDateFromRow(row: { metrics_json: string }): string | null {
  try {
    const parsed = JSON.parse(row.metrics_json || '{}') as { previous_date?: string | null }
    return typeof parsed.previous_date === 'string' && parsed.previous_date ? parsed.previous_date : null
  } catch {
    return null
  }
}

async function initializeSplitMode(
  db: D1Database,
  run: HistoricalQualityRunRow,
  summary: RunSummary,
  collectionDate: string,
  scope: HistoricalQualityDatasetScope,
): Promise<boolean> {
  const lenderCodes = await listDatasetLenderCodesForDate(db, collectionDate, scope)
  if (lenderCodes.length === 0) return false
  await replaceHistoricalQualityFindings(db, run.audit_run_id, collectionDate, scope, [])
  await updateHistoricalQualityRun(db, run.audit_run_id, {
    status: 'running',
    mode: 'split_by_lender',
    nextCollectionDate: collectionDate,
    nextScope: scope,
    lenderCursor: lenderCodes[0],
    lastError: null,
    summary: {
      ...summary,
      split_state: {
        collection_date: collectionDate,
        scope,
        lender_codes: lenderCodes,
        processed_lenders: [],
        aggregate: emptySplitAggregate(),
      },
    },
  })
  return true
}

async function advanceAfterDatasetComplete(
  db: D1Database,
  auditRunId: string,
  dates: string[],
  currentDate: string,
  currentScope: HistoricalQualityDatasetScope,
  summary: RunSummary,
): Promise<{ auditRunId: string; status: string }> {
  const followingScope = nextScope(currentScope)
  if (followingScope) {
    await updateHistoricalQualityRun(db, auditRunId, {
      mode: 'whole_date_scope',
      nextCollectionDate: currentDate,
      nextScope: followingScope,
      lenderCursor: null,
      processedBatchesDelta: 1,
      summary,
    })
    return { auditRunId, status: 'running' }
  }

  const dateRows = (await listHistoricalQualityDailyByRun(db, auditRunId)).filter(
    (row) => row.collection_date === currentDate && row.scope !== 'overall',
  )
  await upsertHistoricalQualityDaily(db, aggregateHistoricalQualityOverallRow(auditRunId, currentDate, dateRows))
  const currentIndex = dates.findIndex((candidate) => candidate === currentDate)
  const nextDate = currentIndex >= 0 ? dates[currentIndex + 1] ?? null : null
  await updateHistoricalQualityRun(db, auditRunId, {
    mode: 'whole_date_scope',
    nextCollectionDate: nextDate,
    nextScope: nextDate ? HISTORICAL_QUALITY_DATASET_SCOPES[0] : null,
    lenderCursor: null,
    processedBatchesDelta: 1,
    completedDatesDelta: 1,
    summary,
  })
  if (!nextDate) {
    await finalizeHistoricalQualityRun(db, auditRunId, summary)
    return { auditRunId, status: 'completed' }
  }
  return { auditRunId, status: 'running' }
}

async function processSplitModeStep(
  env: Pick<EnvBindings, 'DB'>,
  run: HistoricalQualityRunRow,
  dates: string[],
  currentDate: string,
  currentScope: HistoricalQualityDatasetScope,
  summary: RunSummary,
): Promise<{ auditRunId: string; status: string }> {
  const state = summary.split_state
  if (!state || state.collection_date !== currentDate || state.scope !== currentScope) {
    const initialized = await initializeSplitMode(env.DB, run, summary, currentDate, currentScope)
    return { auditRunId: run.audit_run_id, status: initialized ? 'running' : 'partial' }
  }

  const currentLender = run.lender_cursor || nextHistoricalQualityLenderCursor(state.lender_codes, null)
  if (!currentLender) {
    const resetSummary = { ...summary, split_state: undefined }
    await updateHistoricalQualityRun(env.DB, run.audit_run_id, {
      mode: 'whole_date_scope',
      lenderCursor: null,
      summary: resetSummary,
    })
    return { auditRunId: run.audit_run_id, status: 'running' }
  }

  const result = await computeHistoricalQualityDatasetBatch(env.DB, run.audit_run_id, currentDate, currentScope, currentLender)
  await upsertHistoricalQualityFindings(env.DB, run.audit_run_id, currentDate, currentScope, result.findings.findings)
  const aggregate = accumulateSplitAggregate(state.aggregate, {
    dailyRow: result.dailyRow,
    findings: result.findings,
  })
  const nextLender = nextHistoricalQualityLenderCursor(state.lender_codes, currentLender)
  const nextSummary: RunSummary = {
    ...summary,
    split_state: {
      ...state,
      processed_lenders: Array.from(new Set([...state.processed_lenders, currentLender])),
      aggregate,
    },
  }

  if (nextLender) {
    await updateHistoricalQualityRun(env.DB, run.audit_run_id, {
      mode: 'split_by_lender',
      lenderCursor: nextLender,
      processedBatchesDelta: 1,
      summary: nextSummary,
    })
    return { auditRunId: run.audit_run_id, status: 'running' }
  }

  const [reference, runState, permanentEvidencePresent] = await Promise.all([
    loadReferenceWindow(env.DB, currentDate, currentScope),
    loadRunStateSnapshot(env.DB, currentDate, currentScope),
    hasPermanentHistoricalQualityEvidence(env.DB, currentDate, currentScope),
  ])
  let finalDailyRow = buildHistoricalQualityDailyRow({
    auditRunId: run.audit_run_id,
    collectionDate: currentDate,
    scope: currentScope,
    counts: aggregate,
    structure: aggregate,
    provenance: aggregate,
    reference,
    runState,
    permanentEvidencePresent,
    findingMetrics: aggregate,
  })
  const splitFindings = await listHistoricalQualityFindingsByRunDateScope(env.DB, run.audit_run_id, currentDate, currentScope)
  const splitSummary = await computeHistoricalQualityDailySummary(env.DB, {
    collectionDate: currentDate,
    scope: currentScope,
    previousDate: reference.previousDate,
    findings: splitFindings,
  })
  finalDailyRow = attachHistoricalQualityDailySummary(finalDailyRow, splitSummary)
  await upsertHistoricalQualityDaily(env.DB, finalDailyRow)
  const settledSummary = { ...nextSummary, split_state: undefined }
  return advanceAfterDatasetComplete(env.DB, run.audit_run_id, dates, currentDate, currentScope, settledSummary)
}

export async function startHistoricalQualityRun(
  env: Pick<EnvBindings, 'DB'>,
  input?: {
    startDate?: string
    endDate?: string
    triggerSource?: 'manual' | 'script' | 'scheduled'
    targetDb?: string
    auditRunId?: string
    replaceExisting?: boolean
  },
): Promise<{ auditRunId: string }> {
  const dates = await filteredDates(env.DB, input?.startDate, input?.endDate)
  const auditRunId = input?.auditRunId || `historical-quality:${new Date().toISOString()}:${crypto.randomUUID()}`
  const existing = input?.replaceExisting ? await getHistoricalQualityRun(env.DB, auditRunId) : null
  const createInput: {
    auditRunId: string
    triggerSource: 'manual' | 'script' | 'scheduled'
    targetDb: string
    status: HistoricalQualityRunStatus
    nextCollectionDate: string | null
    nextScope: HistoricalQualityDatasetScope | null
    totalDates: number
    filters: { startDate: string | null; endDate: string | null }
    summary: Record<string, unknown>
  } = {
    auditRunId,
    triggerSource: input?.triggerSource ?? 'manual',
    targetDb: input?.targetDb ?? 'australianrates_api',
    status: dates.length === 0 ? 'completed' : 'pending',
    nextCollectionDate: dates[0] ?? null,
    nextScope: dates.length > 0 ? HISTORICAL_QUALITY_DATASET_SCOPES[0] : null,
    totalDates: dates.length,
    filters: { startDate: input?.startDate ?? null, endDate: input?.endDate ?? null },
    summary: dates.length === 0 ? { cutoff_candidates: null, total_daily_rows: 0 } : {},
  }
  if (existing) {
    await restartHistoricalQualityRun(env.DB, createInput)
  } else {
    await createHistoricalQualityRun(env.DB, createInput)
  }
  if (dates.length === 0) {
    await updateHistoricalQualityRun(env.DB, auditRunId, { finished: true })
  }
  return { auditRunId }
}

export async function processHistoricalQualityRunStep(
  env: Pick<EnvBindings, 'DB'>,
  auditRunId: string,
): Promise<{ auditRunId: string; status: string }> {
  const run = await getHistoricalQualityRun(env.DB, auditRunId)
  if (!run) throw new Error(`historical_quality_run_not_found:${auditRunId}`)
  if (run.status === 'completed') return { auditRunId, status: run.status }

  const filters = parseFilters(run.filters_json)
  const summary = parseSummary(run.summary_json)
  const dates = await filteredDates(env.DB, filters.startDate, filters.endDate)
  const currentDate = run.next_collection_date || dates[0]
  const currentScope = run.next_scope || HISTORICAL_QUALITY_DATASET_SCOPES[0]
  if (!currentDate || !currentScope) {
    await finalizeHistoricalQualityRun(env.DB, auditRunId, summary)
    return { auditRunId, status: 'completed' }
  }

  await updateHistoricalQualityRun(env.DB, auditRunId, { status: 'running', lastError: null })
  try {
    if (run.mode === 'split_by_lender') {
      return await processSplitModeStep(env, run, dates, currentDate, currentScope, summary)
    }

    const precheckRowCount = await precheckDateScopeRowCount(env.DB, currentDate, currentScope)
    if (shouldSplitHistoricalQualityBatch(precheckRowCount)) {
      const initialized = await initializeSplitMode(env.DB, run, summary, currentDate, currentScope)
      if (initialized) return { auditRunId, status: 'running' }
    }

    const result = await computeHistoricalQualityDatasetBatch(env.DB, auditRunId, currentDate, currentScope)
    await replaceHistoricalQualityFindings(env.DB, auditRunId, currentDate, currentScope, result.findings.findings)
    const persistedFindings = await listHistoricalQualityFindingsByRunDateScope(env.DB, auditRunId, currentDate, currentScope)
    const summaryForRow = await computeHistoricalQualityDailySummary(env.DB, {
      collectionDate: currentDate,
      scope: currentScope,
      previousDate: previousDateFromRow(result.dailyRow),
      findings: persistedFindings,
    })
    await upsertHistoricalQualityDaily(env.DB, attachHistoricalQualityDailySummary(result.dailyRow, summaryForRow))
    return advanceAfterDatasetComplete(env.DB, auditRunId, dates, currentDate, currentScope, summary)
  } catch (error) {
    if (run.mode === 'whole_date_scope' && shouldRetryAsSplit(error)) {
      const initialized = await initializeSplitMode(env.DB, run, summary, currentDate, currentScope)
      if (initialized) return { auditRunId, status: 'running' }
    }
    await updateHistoricalQualityRun(env.DB, auditRunId, {
      status: 'partial',
      lastError: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function getHistoricalQualityRunDetail(env: Pick<EnvBindings, 'DB'>, auditRunId: string) {
  const [run, daily, findings] = await Promise.all([
    getHistoricalQualityRun(env.DB, auditRunId),
    listHistoricalQualityDailyByRun(env.DB, auditRunId),
    listHistoricalQualityFindingsByRun(env.DB, auditRunId),
  ])
  return { run, daily, findings }
}

export async function listHistoricalQualityRunHistory(env: Pick<EnvBindings, 'DB'>, limit = 20) {
  return listHistoricalQualityRuns(env.DB, limit)
}

export async function processHistoricalQualityRunUntilSettled(
  env: Pick<EnvBindings, 'DB'>,
  auditRunId: string,
  options?: { maxSteps?: number; maxMs?: number },
): Promise<{ auditRunId: string; status: string; steps: number }> {
  const maxSteps = Math.max(1, Math.floor(options?.maxSteps ?? 64))
  const maxMs = Math.max(250, Math.floor(options?.maxMs ?? 20000))
  const startedAt = Date.now()
  let steps = 0
  let last = await processHistoricalQualityRunStep(env, auditRunId)
  steps += 1
  while (last.status === 'running' && steps < maxSteps && Date.now() - startedAt < maxMs) {
    last = await processHistoricalQualityRunStep(env, auditRunId)
    steps += 1
  }
  return { ...last, steps }
}
