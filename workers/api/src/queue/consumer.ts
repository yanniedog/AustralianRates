import { DEFAULT_MAX_QUEUE_ATTEMPTS, TARGET_LENDERS } from '../constants'
import { advanceAutoBackfillAfterDay, releaseAutoBackfillClaim } from '../db/auto-backfill-progress'
import { addHistoricalTaskBatchCounts, claimHistoricalTaskById, finalizeHistoricalTask, getHistoricalRunById } from '../db/client-historical-runs'
import { recordDatasetCoverageRunOutcome, type CoverageDataset } from '../db/dataset-coverage'
import { upsertHistoricalRateRows } from '../db/historical-rates'
import { upsertSavingsRateRows } from '../db/savings-rates'
import { upsertTdRateRows } from '../db/td-rates'
import { getCachedEndpoint } from '../db/endpoint-cache'
import { persistRawPayload } from '../db/raw-payloads'
import { recordRunQueueOutcome } from '../db/run-reports'
import {
  buildBackfillCursorKey,
  cdrCollectionNotes,
  discoverProductsEndpoint,
  fetchProductDetailRows,
  fetchResidentialMortgageProductIds,
} from '../ingest/cdr'
import {
  fetchSavingsProductIds,
  fetchSavingsProductDetailRows,
  fetchTermDepositProductIds,
  fetchTdProductDetailRows,
} from '../ingest/cdr-savings'
import { validateNormalizedSavingsRow, type NormalizedSavingsRow } from '../ingest/normalize-savings'
import { validateNormalizedTdRow, type NormalizedTdRow } from '../ingest/normalize-savings'
import { extractLenderRatesFromHtml } from '../ingest/html-rate-parser'
import { getLenderPlaybook } from '../ingest/lender-playbooks'
import { collectHistoricalDayFromWayback } from '../ingest/wayback-historical'
import { type NormalizedRateRow, validateNormalizedRow } from '../ingest/normalize'
import type {
  BackfillDayJob,
  BackfillSnapshotJob,
  DailyLenderJob,
  DailySavingsLenderJob,
  EnvBindings,
  HistoricalTaskExecuteJob,
  IngestMessage,
  ProductDetailJob,
} from '../types'
import { log } from '../utils/logger'
import { nowIso, parseIntegerEnv } from '../utils/time'

export function calculateRetryDelaySeconds(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts))
  return Math.min(900, 15 * Math.pow(2, safeAttempt - 1))
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function maxProductsPerLender(env: EnvBindings): number {
  return Math.max(10, Math.min(250, parseIntegerEnv(env.MAX_PRODUCTS_PER_LENDER, 80)))
}

async function persistProductDetailPayload(
  env: EnvBindings,
  runSource: 'scheduled' | 'manual' | undefined,
  input: Parameters<typeof persistRawPayload>[1],
): Promise<void> {
  const persistSuccessful = parseBooleanEnv(env.PERSIST_SUCCESSFUL_PRODUCT_DETAILS, false)
  const isScheduled = (runSource ?? 'scheduled') === 'scheduled'
  const isSuccess = (input.httpStatus ?? 200) < 400
  if (isScheduled && isSuccess && !persistSuccessful) {
    return
  }
  await persistRawPayload(env, input)
}

function isNonRetryableErrorMessage(message: string): boolean {
  return (
    message === 'invalid_queue_message_shape' ||
    message.startsWith('unknown_lender_code:') ||
    message.startsWith('daily_ingest_no_valid_rows:') ||
    message.startsWith('historical_run_not_found:') ||
    message.startsWith('historical_task_claim_failed:') ||
    message.startsWith('historical_task_lender_not_found:')
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isIngestMessage(value: unknown): value is IngestMessage {
  if (!isObject(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'daily_lender_fetch') {
    return typeof value.runId === 'string' && typeof value.lenderCode === 'string' && typeof value.collectionDate === 'string'
  }

  if (value.kind === 'product_detail_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.productId === 'string' &&
      typeof value.collectionDate === 'string'
    )
  }

  if (value.kind === 'backfill_snapshot_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.seedUrl === 'string' &&
      typeof value.monthCursor === 'string'
    )
  }

  if (value.kind === 'backfill_day_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.collectionDate === 'string'
    )
  }

  if (value.kind === 'daily_savings_lender_fetch') {
    return typeof value.runId === 'string' && typeof value.lenderCode === 'string' && typeof value.collectionDate === 'string'
  }

  if (value.kind === 'historical_task_execute') {
    return typeof value.runId === 'string' && Number.isFinite(Number(value.taskId))
  }

  return false
}

function extractRunContext(body: unknown): { runId: string | null; lenderCode: string | null } {
  if (!isObject(body)) {
    return { runId: null, lenderCode: null }
  }

  const runId = typeof body.runId === 'string' ? body.runId : null
  const lenderCode = typeof body.lenderCode === 'string' ? body.lenderCode : null
  return { runId, lenderCode }
}

function splitValidatedRows(rows: NormalizedRateRow[]): {
  accepted: NormalizedRateRow[]
  dropped: Array<{ reason: string; productId: string }>
} {
  const accepted: NormalizedRateRow[] = []
  const dropped: Array<{ reason: string; productId: string }> = []
  for (const row of rows) {
    const verdict = validateNormalizedRow(row)
    if (verdict.ok) {
      accepted.push(row)
    } else {
      dropped.push({
        reason: verdict.reason,
        productId: row.productId,
      })
    }
  }
  return { accepted, dropped }
}

function splitValidatedSavingsRows(rows: NormalizedSavingsRow[]) {
  const accepted: NormalizedSavingsRow[] = []
  const dropped: Array<{ reason: string; productId: string }> = []
  for (const row of rows) {
    const verdict = validateNormalizedSavingsRow(row)
    if (verdict.ok) accepted.push(row)
    else dropped.push({ reason: verdict.reason, productId: row.productId })
  }
  return { accepted, dropped }
}

function splitValidatedTdRows(rows: NormalizedTdRow[]) {
  const accepted: NormalizedTdRow[] = []
  const dropped: Array<{ reason: string; productId: string }> = []
  for (const row of rows) {
    const verdict = validateNormalizedTdRow(row)
    if (verdict.ok) accepted.push(row)
    else dropped.push({ reason: verdict.reason, productId: row.productId })
  }
  return { accepted, dropped }
}

function summarizeDropReasons(items: Array<{ reason: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    out[item.reason] = (out[item.reason] || 0) + 1
  }
  return out
}

type HistoricalScope = 'all' | 'mortgage' | 'savings' | 'term_deposits'

function asHistoricalScope(value: unknown): HistoricalScope {
  const scope = String(value || 'all')
  if (scope === 'mortgage' || scope === 'savings' || scope === 'term_deposits') return scope
  return 'all'
}

function scopeCoverageDataset(scope: HistoricalScope): CoverageDataset | null {
  if (scope === 'mortgage' || scope === 'savings' || scope === 'term_deposits') return scope
  return null
}

function rowsWrittenForScope(scope: HistoricalScope, run: { mortgage_rows: number; savings_rows: number; td_rows: number }): number {
  if (scope === 'mortgage') return Math.max(0, Number(run.mortgage_rows || 0))
  if (scope === 'savings') return Math.max(0, Number(run.savings_rows || 0))
  if (scope === 'term_deposits') return Math.max(0, Number(run.td_rows || 0))
  return Math.max(0, Number(run.mortgage_rows || 0)) + Math.max(0, Number(run.savings_rows || 0)) + Math.max(0, Number(run.td_rows || 0))
}

async function handleDailyLenderJob(env: EnvBindings, job: DailyLenderJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }
  log.info('consumer', `daily_lender_fetch started`, { runId: job.runId, lenderCode: job.lenderCode })

  const playbook = getLenderPlaybook(lender)
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  let sourceUrl = ''
  const endpointCandidates: string[] = []
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))

  const collectedRows: NormalizedRateRow[] = []
  let inspectedHtml = 0
  let droppedByParser = 0
  const productCap = maxProductsPerLender(env)

  for (const candidateEndpoint of uniqueCandidates) {
    const products = await fetchResidentialMortgageProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions })
    for (const payload of products.rawPayloads) {
      await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        notes: `daily_product_index lender=${job.lenderCode}`,
      })
    }

    const productIds = products.productIds.slice(0, productCap)
    for (const productId of productIds) {
      const details = await fetchProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })

      await persistProductDetailPayload(env, job.runSource, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `daily_product_detail lender=${job.lenderCode} product=${productId}`,
      })

      for (const row of details.rows) {
        collectedRows.push(row)
      }
    }
    if (collectedRows.length > 0) {
      sourceUrl = candidateEndpoint
      break
    }
  }

  if (collectedRows.length === 0) {
    for (const seedUrl of lender.seed_rate_urls.slice(0, 2)) {
      const response = await fetch(seedUrl)
      const html = await response.text()
      await persistRawPayload(env, {
        sourceType: 'wayback_html',
        sourceUrl: seedUrl,
        payload: html,
        httpStatus: response.status,
        notes: `fallback_scrape lender=${job.lenderCode}`,
      })
      const parsed = extractLenderRatesFromHtml({
        lender,
        html,
        sourceUrl: seedUrl,
        collectionDate: job.collectionDate,
        mode: 'daily',
        qualityFlag: 'scraped_fallback_strict',
      })
      inspectedHtml += parsed.inspected
      droppedByParser += parsed.dropped
      for (const row of parsed.rows) {
        collectedRows.push(row)
      }
    }
  }

  const { accepted, dropped } = splitValidatedRows(collectedRows)
  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  if (accepted.length === 0) {
    await persistRawPayload(env, {
      sourceType: 'cdr_products',
      sourceUrl: sourceUrl || `fallback://${job.lenderCode}`,
      payload: {
        lenderCode: job.lenderCode,
        runId: job.runId,
        collectionDate: job.collectionDate,
        fetchedAt: nowIso(),
        acceptedRows: 0,
        rejectedRows: dropped.length,
        inspectedHtml,
        droppedByParser,
      },
      httpStatus: 422,
      notes: `daily_quality_rejected lender=${job.lenderCode}`,
    })
    log.warn('consumer', `daily_ingest_no_valid_rows`, { runId: job.runId, lenderCode: job.lenderCode })
    throw new Error(`daily_ingest_no_valid_rows:${job.lenderCode}`)
  }

  const written = await upsertHistoricalRateRows(env.DB, accepted)
  log.info('consumer', `daily_lender_fetch completed: ${written} written, ${dropped.length} dropped`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context: `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length}`,
  })

  await persistRawPayload(env, {
    sourceType: 'cdr_products',
    sourceUrl: sourceUrl || `fallback://${job.lenderCode}`,
    payload: {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      productsRows: collectedRows.length,
      acceptedRows: accepted.length,
      rejectedRows: dropped.length,
      inspectedHtml,
      droppedByParser,
    },
    httpStatus: 200,
    notes: cdrCollectionNotes(collectedRows.length, accepted.length),
  })
}

async function handleProductDetailJob(env: EnvBindings, job: ProductDetailJob): Promise<void> {
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!endpoint || !lender) {
    log.warn('consumer', `product_detail_fetch skipped: missing endpoint or lender`, { runId: job.runId, lenderCode: job.lenderCode })
    return
  }
  log.info('consumer', `product_detail_fetch started for ${job.productId}`, { runId: job.runId, lenderCode: job.lenderCode })

  const details = await fetchProductDetailRows({
    lender,
    endpointUrl: endpoint.endpointUrl,
    productId: job.productId,
    collectionDate: job.collectionDate,
    cdrVersions: getLenderPlaybook(lender).cdrVersions,
  })

  await persistProductDetailPayload(env, job.runSource, {
    sourceType: 'cdr_product_detail',
    sourceUrl: details.rawPayload.sourceUrl,
    payload: details.rawPayload.body,
    httpStatus: details.rawPayload.status,
    notes: `direct_product_detail lender=${job.lenderCode} product=${job.productId}`,
  })
  const { accepted } = splitValidatedRows(details.rows)
  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  if (accepted.length > 0) {
    await upsertHistoricalRateRows(env.DB, accepted)
  }
}

async function handleBackfillSnapshotJob(env: EnvBindings, job: BackfillSnapshotJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }
  log.info('consumer', `backfill_snapshot_fetch started month=${job.monthCursor}`, { runId: job.runId, lenderCode: job.lenderCode })

  const [year, month] = job.monthCursor.split('-')
  const from = `${year}${month}01`
  const to = `${year}${month}31`
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    job.seedUrl,
  )}&from=${from}&to=${to}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&collapse=digest&limit=8`
  const cdxResponse = await fetch(cdxUrl)
  const cdxBody = await cdxResponse.text()

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: cdxUrl,
    payload: cdxBody,
    httpStatus: cdxResponse.status,
    notes: `wayback_cdx lender=${job.lenderCode} month=${job.monthCursor}`,
  })

  const rows: Array<Array<string>> = []
  try {
    const parsed = JSON.parse(cdxBody)
    if (Array.isArray(parsed)) {
      for (let i = 1; i < parsed.length; i += 1) {
        if (Array.isArray(parsed[i])) rows.push((parsed[i] as unknown[]).map((x: unknown) => String(x)))
      }
    }
  } catch {
    // keep rows empty
  }

  let writtenRows = 0
  let inspectedTotal = 0
  let droppedTotal = 0
  for (const entry of rows.slice(0, 5)) {
    const timestamp = entry[0]
    const original = entry[1] || job.seedUrl
    if (!timestamp) continue
    const snapshotUrl = `https://web.archive.org/web/${timestamp}/${original}`
    const snapshotResponse = await fetch(snapshotUrl)
    const html = await snapshotResponse.text()

    await persistRawPayload(env, {
      sourceType: 'wayback_html',
      sourceUrl: snapshotUrl,
      payload: html,
      httpStatus: snapshotResponse.status,
      notes: `wayback_snapshot lender=${job.lenderCode}`,
    })

    const collectionDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`
    const parsed = extractLenderRatesFromHtml({
      lender,
      html,
      sourceUrl: snapshotUrl,
      collectionDate,
      mode: 'historical',
      qualityFlag: 'parsed_from_wayback_strict',
    })
    inspectedTotal += parsed.inspected
    droppedTotal += parsed.dropped
    const { accepted, dropped } = splitValidatedRows(parsed.rows)
    for (const row of accepted) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
    }
    droppedTotal += dropped.length
    if (accepted.length > 0) {
      writtenRows += await upsertHistoricalRateRows(env.DB, accepted)
    }
  }

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: job.seedUrl,
    payload: {
      runId: job.runId,
      lenderCode: job.lenderCode,
      monthCursor: job.monthCursor,
      writtenRows,
      inspectedTotal,
      droppedTotal,
      capturedAt: nowIso(),
    },
    httpStatus: 200,
    notes: `wayback_backfill_summary lender=${job.lenderCode} month=${job.monthCursor}`,
  })

  const cursorKey = buildBackfillCursorKey(job.lenderCode, job.monthCursor, job.seedUrl)
  await env.DB.prepare(
    `INSERT INTO backfill_cursors (
      cursor_key,
      run_id,
      lender_code,
      seed_url,
      month_cursor,
      last_snapshot_at,
      updated_at,
      status
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(cursor_key) DO UPDATE SET
      run_id = excluded.run_id,
      lender_code = excluded.lender_code,
      seed_url = excluded.seed_url,
      month_cursor = excluded.month_cursor,
      last_snapshot_at = excluded.last_snapshot_at,
      updated_at = excluded.updated_at,
      status = excluded.status`,
  )
    .bind(
      cursorKey,
      job.runId,
      job.lenderCode,
      job.seedUrl,
      job.monthCursor,
      nowIso(),
      nowIso(),
      writtenRows > 0 ? 'completed' : inspectedTotal > 0 ? 'quality_rejected' : 'empty',
    )
    .run()
}

async function handleBackfillDayJob(env: EnvBindings, job: BackfillDayJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) throw new Error(`unknown_lender_code:${job.lenderCode}`)
  log.info('consumer', `backfill_day_fetch started date=${job.collectionDate}`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
  })

  let hadSignals = false
  try {
    const endpointCandidates: string[] = []
    const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
    if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
    if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
    const discovered = await discoverProductsEndpoint(lender)
    if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
    const collected = await collectHistoricalDayFromWayback({
      lender,
      collectionDate: job.collectionDate,
      endpointCandidates,
      productCap: maxProductsPerLender(env),
      maxSeedUrls: 2,
    })
    hadSignals = collected.hadSignals

    for (const payload of collected.payloads) {
      await persistRawPayload(env, {
        sourceType: 'wayback_html',
        sourceUrl: payload.sourceUrl,
        payload: payload.payload,
        httpStatus: payload.status,
        notes: payload.notes,
      })
    }

    const mortgageRows = collected.mortgageRows
    const savingsRows = collected.savingsRows
    const tdRows = collected.tdRows

    for (const row of mortgageRows) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
      row.retrievalType = 'historical_scrape'
    }
    for (const row of savingsRows) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
      row.retrievalType = 'historical_scrape'
    }
    for (const row of tdRows) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
      row.retrievalType = 'historical_scrape'
    }

    const { accepted: mortgageAccepted } = splitValidatedRows(mortgageRows)
    if (mortgageAccepted.length > 0) {
      await upsertHistoricalRateRows(env.DB, mortgageAccepted)
    }
    const { accepted: savingsAccepted } = splitValidatedSavingsRows(savingsRows)
    if (savingsAccepted.length > 0) {
      await upsertSavingsRateRows(env.DB, savingsAccepted)
    }
    const { accepted: tdAccepted } = splitValidatedTdRows(tdRows)
    if (tdAccepted.length > 0) {
      await upsertTdRateRows(env.DB, tdAccepted)
    }

    await persistRawPayload(env, {
      sourceType: 'wayback_html',
      sourceUrl: `summary://${job.lenderCode}/backfill-day/${job.collectionDate}`,
      payload: {
        runId: job.runId,
        lenderCode: job.lenderCode,
        collectionDate: job.collectionDate,
        mortgage_rows: mortgageAccepted.length,
        savings_rows: savingsAccepted.length,
        td_rows: tdAccepted.length,
        had_signals: hadSignals,
        counters: collected.counters,
        capturedAt: nowIso(),
      },
      httpStatus: 200,
      notes: `wayback_day_summary lender=${job.lenderCode} date=${job.collectionDate}`,
    })

    await advanceAutoBackfillAfterDay(env.DB, {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      hadSignals: hadSignals || mortgageAccepted.length > 0 || savingsAccepted.length > 0 || tdAccepted.length > 0,
    })

    log.info('consumer', `backfill_day_fetch completed`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `date=${job.collectionDate} mortgage=${mortgageAccepted.length} savings=${savingsAccepted.length} td=${tdAccepted.length}`,
    })
  } catch (error) {
    await releaseAutoBackfillClaim(env.DB, {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
    })
    throw error
  }
}

async function handleHistoricalTaskJob(env: EnvBindings, job: HistoricalTaskExecuteJob): Promise<void> {
  const workerId = `queue-historical:${job.runId}:${job.taskId}`
  const claimTtl = Math.max(60, parseIntegerEnv(env.HISTORICAL_TASK_CLAIM_TTL_SECONDS, 900))
  const task = await claimHistoricalTaskById(env.DB, {
    runId: job.runId,
    taskId: job.taskId,
    workerId,
    claimTtlSeconds: claimTtl,
  })
  if (!task) {
    log.info('consumer', 'historical_task_execute skipped (already claimed/completed)', {
      runId: job.runId,
      context: `task_id=${job.taskId}`,
    })
    return
  }

  const run = await getHistoricalRunById(env.DB, job.runId)
  if (!run) {
    await finalizeHistoricalTask(env.DB, {
      taskId: task.task_id,
      runId: job.runId,
      workerId,
      status: 'failed',
      lastError: `historical_run_not_found:${job.runId}`,
      hadSignals: false,
    })
    throw new Error(`historical_run_not_found:${job.runId}`)
  }

  const scope = asHistoricalScope(run.product_scope)
  const lender = TARGET_LENDERS.find((entry) => entry.code === task.lender_code)
  if (!lender) {
    await finalizeHistoricalTask(env.DB, {
      taskId: task.task_id,
      runId: job.runId,
      workerId,
      status: 'failed',
      lastError: `historical_task_lender_not_found:${task.lender_code}`,
      hadSignals: false,
    })
    throw new Error(`historical_task_lender_not_found:${task.lender_code}`)
  }

  log.info('consumer', 'historical_task_execute started', {
    runId: job.runId,
    lenderCode: task.lender_code,
    context: `task_id=${task.task_id} date=${task.collection_date} scope=${scope}`,
  })

  try {
    const endpointCandidates: string[] = []
    const endpoint = await getCachedEndpoint(env.DB, task.lender_code)
    if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
    if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
    const discovered = await discoverProductsEndpoint(lender)
    if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)

    const collected = await collectHistoricalDayFromWayback({
      lender,
      collectionDate: task.collection_date,
      endpointCandidates,
      productCap: maxProductsPerLender(env),
      maxSeedUrls: 2,
    })

    for (const payload of collected.payloads) {
      await persistRawPayload(env, {
        sourceType: 'wayback_html',
        sourceUrl: payload.sourceUrl,
        payload: payload.payload,
        httpStatus: payload.status,
        notes: `${payload.notes} run=${job.runId} task=${task.task_id} scope=${scope}`,
      })
    }

    const mortgageRows = scope === 'all' || scope === 'mortgage' ? collected.mortgageRows : []
    const savingsRows = scope === 'all' || scope === 'savings' ? collected.savingsRows : []
    const tdRows = scope === 'all' || scope === 'term_deposits' ? collected.tdRows : []

    for (const row of mortgageRows) {
      row.runId = job.runId
      row.runSource = run.run_source
      row.retrievalType = 'historical_scrape'
    }
    for (const row of savingsRows) {
      row.runId = job.runId
      row.runSource = run.run_source
      row.retrievalType = 'historical_scrape'
    }
    for (const row of tdRows) {
      row.runId = job.runId
      row.runSource = run.run_source
      row.retrievalType = 'historical_scrape'
    }

    const { accepted: mortgageAccepted } = splitValidatedRows(mortgageRows)
    const { accepted: savingsAccepted } = splitValidatedSavingsRows(savingsRows)
    const { accepted: tdAccepted } = splitValidatedTdRows(tdRows)
    const [mortgageWritten, savingsWritten, tdWritten] = await Promise.all([
      upsertHistoricalRateRows(env.DB, mortgageAccepted),
      upsertSavingsRateRows(env.DB, savingsAccepted),
      upsertTdRateRows(env.DB, tdAccepted),
    ])

    const hadSignals =
      collected.hadSignals || mortgageWritten > 0 || savingsWritten > 0 || tdWritten > 0

    await addHistoricalTaskBatchCounts(env.DB, {
      taskId: task.task_id,
      runId: job.runId,
      mortgageRows: mortgageWritten,
      savingsRows: savingsWritten,
      tdRows: tdWritten,
      hadSignals,
    })

    await finalizeHistoricalTask(env.DB, {
      taskId: task.task_id,
      runId: job.runId,
      workerId,
      status: 'completed',
      hadSignals,
      lastError: null,
    })

    await persistRawPayload(env, {
      sourceType: 'wayback_html',
      sourceUrl: `summary://${task.lender_code}/historical-task/${task.collection_date}`,
      payload: {
        run_id: job.runId,
        task_id: task.task_id,
        lender_code: task.lender_code,
        collection_date: task.collection_date,
        scope,
        parsed_counts: {
          mortgage_rows: mortgageRows.length,
          savings_rows: savingsRows.length,
          td_rows: tdRows.length,
        },
        written_counts: {
          mortgage_rows: mortgageWritten,
          savings_rows: savingsWritten,
          td_rows: tdWritten,
        },
        had_signals: hadSignals,
        counters: collected.counters,
        captured_at: nowIso(),
      },
      httpStatus: 200,
      notes: `historical_task_summary lender=${task.lender_code} date=${task.collection_date} scope=${scope}`,
    })

    log.info('consumer', 'historical_task_execute completed', {
      runId: job.runId,
      lenderCode: task.lender_code,
      context:
        `task_id=${task.task_id} date=${task.collection_date} scope=${scope}` +
        ` parsed(m=${mortgageRows.length},s=${savingsRows.length},td=${tdRows.length})` +
        ` written(m=${mortgageWritten},s=${savingsWritten},td=${tdWritten})`,
    })
  } catch (error) {
    const message = (error as Error)?.message || String(error)
    await finalizeHistoricalTask(env.DB, {
      taskId: task.task_id,
      runId: job.runId,
      workerId,
      status: 'failed',
      hadSignals: false,
      lastError: message.slice(0, 1800),
    })
    log.error('consumer', 'historical_task_execute failed', {
      runId: job.runId,
      lenderCode: task.lender_code,
      context: `task_id=${task.task_id} date=${task.collection_date} error=${message}`,
    })
    throw error
  }

  const runAfter = await getHistoricalRunById(env.DB, job.runId)
  const coverageDataset = scopeCoverageDataset(scope)
  if (
    coverageDataset &&
    runAfter &&
    runAfter.run_source === 'scheduled' &&
    (runAfter.status === 'completed' || runAfter.status === 'partial' || runAfter.status === 'failed')
  ) {
    await recordDatasetCoverageRunOutcome(env.DB, {
      dataset: coverageDataset,
      runId: runAfter.run_id,
      runStatus: runAfter.status,
      rowsWritten: rowsWrittenForScope(scope, runAfter),
      message: `run_status=${runAfter.status} rows=${rowsWrittenForScope(scope, runAfter)}`,
    })
  }
}

async function handleDailySavingsLenderJob(env: EnvBindings, job: DailySavingsLenderJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) throw new Error(`unknown_lender_code:${job.lenderCode}`)
  log.info('consumer', `daily_savings_lender_fetch started`, { runId: job.runId, lenderCode: job.lenderCode })

  const playbook = getLenderPlaybook(lender)
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const endpointCandidates: string[] = []
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))

  const savingsRows: NormalizedSavingsRow[] = []
  const tdRows: NormalizedTdRow[] = []
  const productCap = maxProductsPerLender(env)

  for (const candidateEndpoint of uniqueCandidates) {
    const [savingsProducts, tdProducts] = await Promise.all([
      fetchSavingsProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions }),
      fetchTermDepositProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions }),
    ])

    for (const payload of [...savingsProducts.rawPayloads, ...tdProducts.rawPayloads]) {
      await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        notes: `savings_td_product_index lender=${job.lenderCode}`,
      })
    }

    for (const productId of savingsProducts.productIds.slice(0, productCap)) {
      const details = await fetchSavingsProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })
      await persistProductDetailPayload(env, job.runSource, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `savings_product_detail lender=${job.lenderCode} product=${productId}`,
      })
      for (const row of details.savingsRows) savingsRows.push(row)
    }

    for (const productId of tdProducts.productIds.slice(0, productCap)) {
      const details = await fetchTdProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })
      await persistProductDetailPayload(env, job.runSource, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `td_product_detail lender=${job.lenderCode} product=${productId}`,
      })
      for (const row of details.tdRows) tdRows.push(row)
    }

    if (savingsRows.length > 0 || tdRows.length > 0) break
  }

  const { accepted: savingsAccepted, dropped: savingsDropped } = splitValidatedSavingsRows(savingsRows)
  for (const row of savingsAccepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  if (savingsAccepted.length > 0) {
    const written = await upsertSavingsRateRows(env.DB, savingsAccepted)
    log.info('consumer', `savings_lender_fetch: ${written} savings rows written`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
    })
  }

  const { accepted: tdAccepted, dropped: tdDropped } = splitValidatedTdRows(tdRows)
  for (const row of tdAccepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  if (tdAccepted.length > 0) {
    const written = await upsertTdRateRows(env.DB, tdAccepted)
    log.info('consumer', `savings_lender_fetch: ${written} td rows written`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
    })
  }

  await persistRawPayload(env, {
    sourceType: 'cdr_products',
    sourceUrl: `summary://${job.lenderCode}/savings-td`,
    payload: {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      savings: {
        inspected: savingsRows.length,
        accepted: savingsAccepted.length,
        dropped: savingsDropped.length,
        reasons: summarizeDropReasons(savingsDropped),
      },
      term_deposits: {
        inspected: tdRows.length,
        accepted: tdAccepted.length,
        dropped: tdDropped.length,
        reasons: summarizeDropReasons(tdDropped),
      },
      source_mix: {
        [job.runSource ?? 'scheduled']: savingsAccepted.length + tdAccepted.length,
      },
    },
    httpStatus: 200,
    notes: `savings_td_quality_summary lender=${job.lenderCode}`,
  })

  log.info('consumer', `daily_savings_lender_fetch completed`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context: `savings=${savingsAccepted.length}/${savingsRows.length} td=${tdAccepted.length}/${tdRows.length}`,
  })
}

async function processMessage(env: EnvBindings, message: IngestMessage): Promise<void> {
  if (message.kind === 'daily_lender_fetch') {
    return handleDailyLenderJob(env, message)
  }
  if (message.kind === 'product_detail_fetch') {
    return handleProductDetailJob(env, message)
  }
  if (message.kind === 'backfill_snapshot_fetch') {
    return handleBackfillSnapshotJob(env, message)
  }
  if (message.kind === 'backfill_day_fetch') {
    return handleBackfillDayJob(env, message)
  }
  if (message.kind === 'daily_savings_lender_fetch') {
    return handleDailySavingsLenderJob(env, message)
  }
  if (message.kind === 'historical_task_execute') {
    return handleHistoricalTaskJob(env, message)
  }

  throw new Error(`Unsupported message kind: ${String((message as Record<string, unknown>).kind)}`)
}

export async function consumeIngestQueue(batch: MessageBatch<IngestMessage>, env: EnvBindings): Promise<void> {
  const maxAttempts = parseIntegerEnv(env.MAX_QUEUE_ATTEMPTS, DEFAULT_MAX_QUEUE_ATTEMPTS)
  log.info('consumer', `queue_batch received ${batch.messages.length} messages`)

  for (const msg of batch.messages) {
    const attempts = Number(msg.attempts || 1)
    const body = msg.body
    const context = extractRunContext(body)

    try {
      if (!isIngestMessage(body)) {
        log.error('consumer', 'invalid_queue_message_shape', { context: JSON.stringify(body) })
        throw new Error('invalid_queue_message_shape')
      }

      await processMessage(env, body)

      if (context.runId && context.lenderCode) {
        await recordRunQueueOutcome(env.DB, {
          runId: context.runId,
          lenderCode: context.lenderCode,
          success: true,
        })
      }

      msg.ack()
    } catch (error) {
      const errorMessage = (error as Error)?.message || String(error)
      log.error('consumer', `queue_message_failed attempt=${attempts}/${maxAttempts}: ${errorMessage}`, {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
      })

      if (isNonRetryableErrorMessage(errorMessage)) {
        log.warn('consumer', 'queue_message_non_retryable', {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: errorMessage,
        })
        if (context.runId && context.lenderCode) {
          await recordRunQueueOutcome(env.DB, {
            runId: context.runId,
            lenderCode: context.lenderCode,
            success: false,
            errorMessage,
          })
        }
        msg.ack()
        continue
      }

      if (attempts >= maxAttempts) {
        log.error('consumer', `queue_message_exhausted max_attempts=${maxAttempts}`, {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: errorMessage,
        })
        if (context.runId && context.lenderCode) {
          await recordRunQueueOutcome(env.DB, {
            runId: context.runId,
            lenderCode: context.lenderCode,
            success: false,
            errorMessage,
          })
        }
        msg.ack()
        continue
      }

      msg.retry({
        delaySeconds: calculateRetryDelaySeconds(attempts),
      })
    }
  }
}
