import { DEFAULT_MAX_QUEUE_ATTEMPTS, TARGET_LENDERS } from '../constants'
import { advanceAutoBackfillAfterDay, releaseAutoBackfillClaim } from '../db/auto-backfill-progress'
import { addHistoricalTaskBatchCounts, claimHistoricalTaskById, finalizeHistoricalTask, getHistoricalRunById } from '../db/client-historical-runs'
import { recordDatasetCoverageRunOutcome, type CoverageDataset } from '../db/dataset-coverage'
import { upsertHistoricalRateRows } from '../db/historical-rates'
import { markMissingProductsRemoved, markProductsSeen } from '../db/product-status'
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

function summarizeEndpointHosts(values: string[]): string {
  return values
    .map((value) => {
      try {
        return new URL(value).host
      } catch {
        return value
      }
    })
    .join(',')
}

function shortUrlForLog(value: string): string {
  try {
    const parsed = new URL(value)
    return `${parsed.host}${parsed.pathname}`.replace(/\/{2,}/g, '/')
  } catch {
    return value
  }
}

function summarizeProductSample(productIds: string[], limit = 5): string {
  if (productIds.length === 0) return 'none'
  const sample = productIds.slice(0, limit).join(',')
  if (productIds.length <= limit) return sample
  return `${sample},...(+${productIds.length - limit})`
}

function serializeForLog(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function summarizeStatusCodes(statuses: Array<number | undefined>): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const status of statuses) {
    const key = Number.isFinite(Number(status)) ? String(status) : 'unknown'
    summary[key] = (summary[key] || 0) + 1
  }
  return summary
}

function mergeSummary(target: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  for (const key of Object.keys(incoming)) {
    target[key] = (target[key] || 0) + (incoming[key] || 0)
  }
  return target
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs)
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
  const jobStartedAt = Date.now()
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }
  log.info('consumer', `daily_lender_fetch started`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} run_source=${job.runSource ?? 'scheduled'}` +
      ` attempt=${job.attempt} idempotency=${job.idempotencyKey}`,
  })

  const playbook = getLenderPlaybook(lender)
  const endpointDiscoveryStartedAt = Date.now()
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  let sourceUrl = ''
  const endpointCandidates: string[] = []
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))
  const endpointHosts = summarizeEndpointHosts(uniqueCandidates)
  const endpointDiscoveryMs = elapsedMs(endpointDiscoveryStartedAt)

  const collectedRows: NormalizedRateRow[] = []
  let inspectedHtml = 0
  let droppedByParser = 0
  const productCap = maxProductsPerLender(env)
  let endpointsTried = 0
  let indexPayloads = 0
  let productIdsDiscovered = 0
  let productDetailsRequested = 0
  let removalSyncProductIds: string[] | null = null
  let fallbackSeedFetches = 0
  const endpointDiagnostics: Array<Record<string, unknown>> = []
  const seedDiagnostics: Array<Record<string, unknown>> = []
  let collectionMs = 0
  let validationMs = 0
  let writeMs = 0
  const syncRemovalStatus = async (): Promise<void> => {
    if (removalSyncProductIds == null) {
      log.info('consumer', 'daily_lender_fetch removal_sync_skipped', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context: 'reason=no_successful_cdr_index_fetch',
      })
      return
    }

    const bankName = lender.canonical_bank_name || lender.name
    const removalStartedAt = Date.now()
    const seenTouched = await markProductsSeen(env.DB, {
      section: 'home_loans',
      bankName,
      productIds: removalSyncProductIds,
      collectionDate: job.collectionDate,
      runId: job.runId,
    })
    const removedTouched = await markMissingProductsRemoved(env.DB, {
      section: 'home_loans',
      bankName,
      activeProductIds: removalSyncProductIds,
    })
    log.info('consumer', 'daily_lender_fetch removal_sync', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `bank=${bankName} discovered=${removalSyncProductIds.length}` +
        ` seen_touched=${seenTouched} removed_touched=${removedTouched}` +
        ` elapsed_ms=${elapsedMs(removalStartedAt)}`,
    })
  }

  log.info('consumer', 'daily_lender_fetch collect', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} endpoints=${uniqueCandidates.length}` +
      ` endpoint_hosts=${endpointHosts || 'none'}` +
      ` seeds=${Math.min(2, lender.seed_rate_urls.length)} product_cap=${productCap}` +
      ` discovery_ms=${endpointDiscoveryMs}`,
  })

  const collectionStartedAt = Date.now()
  for (const [endpointIndex, candidateEndpoint] of uniqueCandidates.entries()) {
    const endpointStartedAt = Date.now()
    endpointsTried += 1
    log.info('consumer', 'daily_lender_fetch endpoint_attempt', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `endpoint_idx=${endpointIndex + 1}/${uniqueCandidates.length}` +
        ` endpoint=${shortUrlForLog(candidateEndpoint)}`,
    })
    const products = await fetchResidentialMortgageProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions })
    indexPayloads += products.rawPayloads.length
    productIdsDiscovered += products.productIds.length
    const endpointRowsBefore = collectedRows.length
    const indexStatusSummary = summarizeStatusCodes(products.rawPayloads.map((payload) => payload.status))
    const indexFetchSucceeded =
      products.rawPayloads.length > 0 && products.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (indexFetchSucceeded && removalSyncProductIds == null) {
      removalSyncProductIds = products.productIds.slice()
    }
    let endpointDetailRows = 0
    const detailStatuses: number[] = []
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
    productDetailsRequested += productIds.length
    for (const productId of productIds) {
      const detailStartedAt = Date.now()
      const details = await fetchProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })
      detailStatuses.push(details.rawPayload.status)
      endpointDetailRows += details.rows.length

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

      if (details.rows.length === 0) {
        log.debug('consumer', 'daily_lender_fetch product_detail_empty', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `endpoint=${shortUrlForLog(candidateEndpoint)} product=${productId}` +
            ` status=${details.rawPayload.status} elapsed_ms=${elapsedMs(detailStartedAt)}`,
        })
      }
    }
    const endpointRowsCollected = collectedRows.length - endpointRowsBefore
    const endpointElapsedMs = elapsedMs(endpointStartedAt)
    const endpointSummary = {
      endpoint: candidateEndpoint,
      index_payloads: products.rawPayloads.length,
      index_statuses: indexStatusSummary,
      product_ids_discovered: products.productIds.length,
      product_ids_sample: summarizeProductSample(products.productIds),
      product_ids_used: productIds.length,
      detail_statuses: summarizeStatusCodes(detailStatuses),
      detail_rows: endpointDetailRows,
      rows_collected: endpointRowsCollected,
      elapsed_ms: endpointElapsedMs,
    }
    endpointDiagnostics.push(endpointSummary)
    log.info('consumer', 'daily_lender_fetch endpoint_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `endpoint_idx=${endpointIndex + 1}/${uniqueCandidates.length}` +
        ` endpoint=${shortUrlForLog(candidateEndpoint)}` +
        ` index_payloads=${products.rawPayloads.length} index_statuses=${serializeForLog(indexStatusSummary)}` +
        ` discovered=${products.productIds.length} used=${productIds.length}` +
        ` sample_products=${summarizeProductSample(products.productIds)}` +
        ` detail_rows=${endpointDetailRows} collected=${endpointRowsCollected}` +
        ` detail_statuses=${serializeForLog(summarizeStatusCodes(detailStatuses))}` +
        ` elapsed_ms=${endpointElapsedMs}`,
    })
    if (collectedRows.length > 0) {
      sourceUrl = candidateEndpoint
      break
    }
  }

  if (collectedRows.length === 0) {
    log.info('consumer', 'daily_lender_fetch fallback_html_start', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `seed_count=${Math.min(2, lender.seed_rate_urls.length)}`,
    })
    for (const seedUrl of lender.seed_rate_urls.slice(0, 2)) {
      const seedStartedAt = Date.now()
      fallbackSeedFetches += 1
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
      const seedSummary = {
        seed_url: seedUrl,
        status: response.status,
        html_bytes: html.length,
        inspected: parsed.inspected,
        parsed_rows: parsed.rows.length,
        dropped: parsed.dropped,
        elapsed_ms: elapsedMs(seedStartedAt),
      }
      seedDiagnostics.push(seedSummary)
      log.info('consumer', 'daily_lender_fetch fallback_seed_result', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `seed=${shortUrlForLog(seedUrl)} status=${response.status}` +
          ` html_bytes=${html.length} inspected=${parsed.inspected}` +
          ` parsed_rows=${parsed.rows.length} dropped=${parsed.dropped}` +
          ` elapsed_ms=${seedSummary.elapsed_ms}`,
      })
    }
  }
  collectionMs = elapsedMs(collectionStartedAt)

  const validationStartedAt = Date.now()
  const { accepted, dropped } = splitValidatedRows(collectedRows)
  const droppedReasons = summarizeDropReasons(dropped)
  const droppedProductsSample = summarizeProductSample(dropped.map((item) => item.productId))
  validationMs = elapsedMs(validationStartedAt)
  log.info('consumer', 'daily_lender_fetch validation', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length}` +
      ` dropped_products=${droppedProductsSample}` +
      ` reasons=${serializeForLog(droppedReasons)} validation_ms=${validationMs}`,
  })

  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  const hadMortgageSignals = collectedRows.length > 0 || inspectedHtml > 0 || droppedByParser > 0
  if (accepted.length === 0) {
    await syncRemovalStatus()
    const noMortgageSignals = !hadMortgageSignals
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
        droppedReasons,
        inspectedHtml,
        droppedByParser,
        hadMortgageSignals,
        collection: {
          endpointsTried,
          indexPayloads,
          productIdsDiscovered,
          productDetailsRequested,
          fallbackSeedFetches,
        },
        endpointDiagnostics,
        seedDiagnostics,
        timings: {
          endpointDiscoveryMs,
          collectionMs,
          validationMs,
          writeMs,
          totalMs: elapsedMs(jobStartedAt),
        },
      },
      httpStatus: noMortgageSignals ? 204 : 422,
      notes: noMortgageSignals ? `daily_no_data lender=${job.lenderCode}` : `daily_quality_rejected lender=${job.lenderCode}`,
    })
    if (noMortgageSignals) {
      log.info('consumer', `daily_lender_fetch completed: 0 written, no mortgage signals`, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `collected=0 inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
          ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
          ` product_ids=${productIdsDiscovered} detail_requests=${productDetailsRequested}` +
          ` seed_fetches=${fallbackSeedFetches} timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},validate=${validationMs},total=${elapsedMs(jobStartedAt)}`,
      })
      return
    }
    log.warn('consumer', `daily_ingest_no_valid_rows`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `collected=${collectedRows.length} accepted=0 dropped=${dropped.length}` +
        ` reasons=${JSON.stringify(droppedReasons)}` +
        ` inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
        ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
        ` product_ids=${productIdsDiscovered} detail_requests=${productDetailsRequested}` +
        ` seed_fetches=${fallbackSeedFetches}` +
        ` endpoint_diagnostics=${serializeForLog(endpointDiagnostics)}` +
        ` seed_diagnostics=${serializeForLog(seedDiagnostics)}` +
        ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},validate=${validationMs},total=${elapsedMs(jobStartedAt)}`,
    })
    throw new Error(`daily_ingest_no_valid_rows:${job.lenderCode}`)
  }

  const writeStartedAt = Date.now()
  const written = await upsertHistoricalRateRows(env.DB, accepted)
  writeMs = elapsedMs(writeStartedAt)
  await syncRemovalStatus()
  log.info('consumer', `daily_lender_fetch completed: ${written} written, ${dropped.length} dropped`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length} written=${written}` +
      ` reasons=${JSON.stringify(droppedReasons)}` +
      ` inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
      ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
      ` product_ids=${productIdsDiscovered} detail_requests=${productDetailsRequested}` +
      ` seed_fetches=${fallbackSeedFetches}` +
      ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},validate=${validationMs},write=${writeMs},total=${elapsedMs(jobStartedAt)}`,
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
      droppedReasons,
      inspectedHtml,
      droppedByParser,
      collection: {
        endpointsTried,
        indexPayloads,
        productIdsDiscovered,
        productDetailsRequested,
        fallbackSeedFetches,
      },
      endpointDiagnostics,
      seedDiagnostics,
      timings: {
        endpointDiscoveryMs,
        collectionMs,
        validationMs,
        writeMs,
        totalMs: elapsedMs(jobStartedAt),
      },
    },
    httpStatus: 200,
    notes: cdrCollectionNotes(collectedRows.length, accepted.length),
  })
}

async function handleProductDetailJob(env: EnvBindings, job: ProductDetailJob): Promise<void> {
  const startedAt = Date.now()
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!endpoint || !lender) {
    log.warn('consumer', `product_detail_fetch skipped: missing endpoint or lender`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `product=${job.productId} date=${job.collectionDate}` +
        ` has_endpoint=${endpoint ? 1 : 0} has_lender=${lender ? 1 : 0}`,
    })
    return
  }
  log.info('consumer', `product_detail_fetch started for ${job.productId}`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} endpoint=${shortUrlForLog(endpoint.endpointUrl)}` +
      ` run_source=${job.runSource ?? 'scheduled'} attempt=${job.attempt}`,
  })

  const fetchStartedAt = Date.now()
  const details = await fetchProductDetailRows({
    lender,
    endpointUrl: endpoint.endpointUrl,
    productId: job.productId,
    collectionDate: job.collectionDate,
    cdrVersions: getLenderPlaybook(lender).cdrVersions,
  })
  const fetchMs = elapsedMs(fetchStartedAt)

  log.info('consumer', 'product_detail_fetch fetched', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `product=${job.productId} status=${details.rawPayload.status}` +
      ` rows=${details.rows.length} fetch_ms=${fetchMs}`,
  })

  await persistProductDetailPayload(env, job.runSource, {
    sourceType: 'cdr_product_detail',
    sourceUrl: details.rawPayload.sourceUrl,
    payload: details.rawPayload.body,
    httpStatus: details.rawPayload.status,
    notes: `direct_product_detail lender=${job.lenderCode} product=${job.productId}`,
  })

  const validationStartedAt = Date.now()
  const { accepted, dropped } = splitValidatedRows(details.rows)
  const validationMs = elapsedMs(validationStartedAt)
  const droppedReasons = summarizeDropReasons(dropped)
  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  let written = 0
  if (accepted.length > 0) {
    const writeStartedAt = Date.now()
    written = await upsertHistoricalRateRows(env.DB, accepted)
    log.info('consumer', 'product_detail_fetch write_completed', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `product=${job.productId} written=${written} write_ms=${elapsedMs(writeStartedAt)}`,
    })
  } else {
    log.warn('consumer', 'product_detail_fetch no_valid_rows', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `product=${job.productId} fetched=${details.rows.length}` +
        ` dropped=${dropped.length} reasons=${serializeForLog(droppedReasons)}`,
    })
  }

  log.info('consumer', 'product_detail_fetch completed', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `product=${job.productId} fetched=${details.rows.length} accepted=${accepted.length}` +
      ` dropped=${dropped.length} written=${written}` +
      ` reasons=${serializeForLog(droppedReasons)}` +
      ` timings(ms):fetch=${fetchMs},validate=${validationMs},total=${elapsedMs(startedAt)}`,
  })
}

async function handleBackfillSnapshotJob(env: EnvBindings, job: BackfillSnapshotJob): Promise<void> {
  const startedAt = Date.now()
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }
  log.info('consumer', `backfill_snapshot_fetch started month=${job.monthCursor}`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `seed=${shortUrlForLog(job.seedUrl)} run_source=${job.runSource ?? 'scheduled'}` +
      ` attempt=${job.attempt} idempotency=${job.idempotencyKey}`,
  })

  const [year, month] = job.monthCursor.split('-')
  const from = `${year}${month}01`
  const to = `${year}${month}31`
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    job.seedUrl,
  )}&from=${from}&to=${to}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&collapse=digest&limit=8`
  const cdxFetchStartedAt = Date.now()
  const cdxResponse = await fetch(cdxUrl)
  const cdxBody = await cdxResponse.text()
  const cdxFetchMs = elapsedMs(cdxFetchStartedAt)

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: cdxUrl,
    payload: cdxBody,
    httpStatus: cdxResponse.status,
    notes: `wayback_cdx lender=${job.lenderCode} month=${job.monthCursor}`,
  })

  const rows: Array<Array<string>> = []
  let cdxParseError: string | null = null
  try {
    const parsed = JSON.parse(cdxBody)
    if (Array.isArray(parsed)) {
      for (let i = 1; i < parsed.length; i += 1) {
        if (Array.isArray(parsed[i])) rows.push((parsed[i] as unknown[]).map((x: unknown) => String(x)))
      }
    }
  } catch (error) {
    cdxParseError = (error as Error)?.message || String(error)
  }
  log.info('consumer', 'backfill_snapshot_fetch cdx_result', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `month=${job.monthCursor} cdx_status=${cdxResponse.status}` +
      ` body_bytes=${cdxBody.length} rows=${rows.length} fetch_ms=${cdxFetchMs}` +
      ` parse_error=${cdxParseError ?? 'none'}`,
  })
  if (rows.length === 0) {
    log.warn('consumer', 'backfill_snapshot_fetch empty_cdx_rows', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `month=${job.monthCursor} cdx_status=${cdxResponse.status} parse_error=${cdxParseError ?? 'none'}`,
    })
  }

  let writtenRows = 0
  let inspectedTotal = 0
  let parserDroppedTotal = 0
  let validationDroppedTotal = 0
  let acceptedTotal = 0
  let snapshotFetchMsTotal = 0
  let parseMsTotal = 0
  let writeMsTotal = 0
  const validationDroppedReasons: Record<string, number> = {}
  const snapshotStatusSummary: Record<string, number> = {}
  const snapshotRows = rows.slice(0, 5)
  for (const [snapshotIndex, entry] of snapshotRows.entries()) {
    const timestamp = entry[0]
    const original = entry[1] || job.seedUrl
    if (!timestamp) continue
    const snapshotStartedAt = Date.now()
    const snapshotUrl = `https://web.archive.org/web/${timestamp}/${original}`
    const snapshotResponse = await fetch(snapshotUrl)
    const html = await snapshotResponse.text()
    const snapshotFetchMs = elapsedMs(snapshotStartedAt)
    snapshotFetchMsTotal += snapshotFetchMs
    snapshotStatusSummary[String(snapshotResponse.status)] = (snapshotStatusSummary[String(snapshotResponse.status)] || 0) + 1

    await persistRawPayload(env, {
      sourceType: 'wayback_html',
      sourceUrl: snapshotUrl,
      payload: html,
      httpStatus: snapshotResponse.status,
      notes: `wayback_snapshot lender=${job.lenderCode}`,
    })

    const collectionDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`
    const parseStartedAt = Date.now()
    const parsed = extractLenderRatesFromHtml({
      lender,
      html,
      sourceUrl: snapshotUrl,
      collectionDate,
      mode: 'historical',
      qualityFlag: 'parsed_from_wayback_strict',
    })
    const parseMs = elapsedMs(parseStartedAt)
    parseMsTotal += parseMs
    inspectedTotal += parsed.inspected
    parserDroppedTotal += parsed.dropped
    const { accepted, dropped } = splitValidatedRows(parsed.rows)
    acceptedTotal += accepted.length
    for (const row of accepted) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
    }
    const droppedReasons = summarizeDropReasons(dropped)
    mergeSummary(validationDroppedReasons, droppedReasons)
    validationDroppedTotal += dropped.length
    let writtenForSnapshot = 0
    if (accepted.length > 0) {
      const writeStartedAt = Date.now()
      writtenForSnapshot = await upsertHistoricalRateRows(env.DB, accepted)
      writeMsTotal += elapsedMs(writeStartedAt)
      writtenRows += writtenForSnapshot
    }
    log.info('consumer', 'backfill_snapshot_fetch snapshot_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `snapshot_idx=${snapshotIndex + 1}/${snapshotRows.length}` +
        ` timestamp=${timestamp} date=${collectionDate}` +
        ` status=${snapshotResponse.status} html_bytes=${html.length}` +
        ` parsed=${parsed.rows.length} inspected=${parsed.inspected}` +
        ` parser_dropped=${parsed.dropped}` +
        ` accepted=${accepted.length} dropped=${dropped.length}` +
        ` written=${writtenForSnapshot}` +
        ` dropped_reasons=${serializeForLog(droppedReasons)}` +
        ` timings(ms):fetch=${snapshotFetchMs},parse=${parseMs}`,
    })
  }
  const droppedTotal = parserDroppedTotal + validationDroppedTotal

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: job.seedUrl,
    payload: {
      runId: job.runId,
      lenderCode: job.lenderCode,
      monthCursor: job.monthCursor,
      writtenRows,
      inspectedTotal,
      acceptedTotal,
      parserDroppedTotal,
      validationDroppedTotal,
      droppedTotal,
      droppedReasons: validationDroppedReasons,
      snapshotStatusSummary,
      cdx: {
        url: cdxUrl,
        status: cdxResponse.status,
        rows: rows.length,
        parseError: cdxParseError,
        fetchMs: cdxFetchMs,
      },
      timing: {
        snapshotFetchMsTotal,
        parseMsTotal,
        writeMsTotal,
        totalMs: elapsedMs(startedAt),
      },
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

  log.info('consumer', 'backfill_snapshot_fetch completed', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `month=${job.monthCursor} snapshots=${snapshotRows.length}` +
      ` written=${writtenRows} accepted=${acceptedTotal}` +
      ` dropped(parser=${parserDroppedTotal},validate=${validationDroppedTotal})` +
      ` reasons=${serializeForLog(validationDroppedReasons)}` +
      ` snapshot_statuses=${serializeForLog(snapshotStatusSummary)}` +
      ` timings(ms):cdx=${cdxFetchMs},snap_fetch=${snapshotFetchMsTotal},parse=${parseMsTotal},write=${writeMsTotal},total=${elapsedMs(startedAt)}`,
  })
}

async function handleBackfillDayJob(env: EnvBindings, job: BackfillDayJob): Promise<void> {
  const startedAt = Date.now()
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) throw new Error(`unknown_lender_code:${job.lenderCode}`)
  log.info('consumer', `backfill_day_fetch started date=${job.collectionDate}`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `run_source=${job.runSource ?? 'scheduled'} attempt=${job.attempt}` +
      ` idempotency=${job.idempotencyKey}`,
  })

  let hadSignals = false
  try {
    const endpointDiscoveryStartedAt = Date.now()
    const endpointCandidates: string[] = []
    const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
    if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
    if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
    const discovered = await discoverProductsEndpoint(lender)
    if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
    const uniqueEndpointCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))
    const endpointDiscoveryMs = elapsedMs(endpointDiscoveryStartedAt)
    log.info('consumer', 'backfill_day_fetch collect', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} endpoints=${uniqueEndpointCandidates.length}` +
        ` endpoint_hosts=${summarizeEndpointHosts(uniqueEndpointCandidates) || 'none'}` +
        ` product_cap=${maxProductsPerLender(env)} discovery_ms=${endpointDiscoveryMs}`,
    })

    const collectStartedAt = Date.now()
    const collected = await collectHistoricalDayFromWayback({
      lender,
      collectionDate: job.collectionDate,
      endpointCandidates: uniqueEndpointCandidates,
      productCap: maxProductsPerLender(env),
      maxSeedUrls: 2,
    })
    const collectMs = elapsedMs(collectStartedAt)
    hadSignals = collected.hadSignals

    const payloadStatusSummary = summarizeStatusCodes(collected.payloads.map((payload) => payload.status))
    log.info('consumer', 'backfill_day_fetch collect_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} payloads=${collected.payloads.length}` +
        ` statuses=${serializeForLog(payloadStatusSummary)}` +
        ` counters(cdx=${collected.counters.cdx_requests},snap=${collected.counters.snapshot_requests})` +
        ` parsed(m=${collected.mortgageRows.length},s=${collected.savingsRows.length},td=${collected.tdRows.length})` +
        ` had_wayback_signals=${collected.hadSignals ? 1 : 0} collect_ms=${collectMs}`,
    })

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

    const validateStartedAt = Date.now()
    const { accepted: mortgageAccepted, dropped: mortgageDropped } = splitValidatedRows(mortgageRows)
    const { accepted: savingsAccepted, dropped: savingsDropped } = splitValidatedSavingsRows(savingsRows)
    const { accepted: tdAccepted, dropped: tdDropped } = splitValidatedTdRows(tdRows)
    const mortgageDroppedReasons = summarizeDropReasons(mortgageDropped)
    const savingsDroppedReasons = summarizeDropReasons(savingsDropped)
    const tdDroppedReasons = summarizeDropReasons(tdDropped)
    const validateMs = elapsedMs(validateStartedAt)

    log.info('consumer', 'backfill_day_fetch validation', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate}` +
        ` accepted(m=${mortgageAccepted.length},s=${savingsAccepted.length},td=${tdAccepted.length})` +
        ` dropped(m=${mortgageDropped.length},s=${savingsDropped.length},td=${tdDropped.length})` +
        ` reasons(m=${serializeForLog(mortgageDroppedReasons)},s=${serializeForLog(savingsDroppedReasons)},td=${serializeForLog(tdDroppedReasons)})` +
        ` validate_ms=${validateMs}`,
    })

    const writeStartedAt = Date.now()
    const [mortgageWritten, savingsWritten, tdWritten] = await Promise.all([
      upsertHistoricalRateRows(env.DB, mortgageAccepted),
      upsertSavingsRateRows(env.DB, savingsAccepted),
      upsertTdRateRows(env.DB, tdAccepted),
    ])
    const writeMs = elapsedMs(writeStartedAt)
    const finalSignals = hadSignals || mortgageWritten > 0 || savingsWritten > 0 || tdWritten > 0

    log.info('consumer', 'backfill_day_fetch write_completed', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} written(m=${mortgageWritten},s=${savingsWritten},td=${tdWritten})` +
        ` write_ms=${writeMs}`,
    })

    await persistRawPayload(env, {
      sourceType: 'wayback_html',
      sourceUrl: `summary://${job.lenderCode}/backfill-day/${job.collectionDate}`,
      payload: {
        runId: job.runId,
        lenderCode: job.lenderCode,
        collectionDate: job.collectionDate,
        parsed_counts: {
          mortgage_rows: mortgageRows.length,
          savings_rows: savingsRows.length,
          td_rows: tdRows.length,
        },
        accepted_counts: {
          mortgage_rows: mortgageAccepted.length,
          savings_rows: savingsAccepted.length,
          td_rows: tdAccepted.length,
        },
        dropped_counts: {
          mortgage_rows: mortgageDropped.length,
          savings_rows: savingsDropped.length,
          td_rows: tdDropped.length,
        },
        dropped_reasons: {
          mortgage: mortgageDroppedReasons,
          savings: savingsDroppedReasons,
          term_deposits: tdDroppedReasons,
        },
        written_counts: {
          mortgage_rows: mortgageWritten,
          savings_rows: savingsWritten,
          td_rows: tdWritten,
        },
        had_signals: finalSignals,
        had_wayback_signals: hadSignals,
        endpoint_candidates: uniqueEndpointCandidates,
        payload_statuses: payloadStatusSummary,
        counters: collected.counters,
        timing: {
          endpointDiscoveryMs,
          collectMs,
          validateMs,
          writeMs,
          totalMs: elapsedMs(startedAt),
        },
        capturedAt: nowIso(),
      },
      httpStatus: 200,
      notes: `wayback_day_summary lender=${job.lenderCode} date=${job.collectionDate}`,
    })

    if (mortgageRows.length + savingsRows.length + tdRows.length === 0 && mortgageWritten + savingsWritten + tdWritten === 0) {
      log.warn('consumer', 'backfill_day_fetch empty_result', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `date=${job.collectionDate} payloads=${collected.payloads.length}` +
          ` statuses=${serializeForLog(payloadStatusSummary)}` +
          ` had_wayback_signals=${hadSignals ? 1 : 0}` +
          ` counters(cdx=${collected.counters.cdx_requests},snap=${collected.counters.snapshot_requests})`,
      })
    }

    await advanceAutoBackfillAfterDay(env.DB, {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      hadSignals: finalSignals,
    })

    log.info('consumer', `backfill_day_fetch completed`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate}` +
        ` parsed(m=${mortgageRows.length},s=${savingsRows.length},td=${tdRows.length})` +
        ` accepted(m=${mortgageAccepted.length},s=${savingsAccepted.length},td=${tdAccepted.length})` +
        ` dropped(m=${mortgageDropped.length},s=${savingsDropped.length},td=${tdDropped.length})` +
        ` written(m=${mortgageWritten},s=${savingsWritten},td=${tdWritten})` +
        ` signals(wayback=${hadSignals ? 1 : 0},final=${finalSignals ? 1 : 0})` +
        ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectMs},validate=${validateMs},write=${writeMs},total=${elapsedMs(startedAt)}`,
    })
  } catch (error) {
    await releaseAutoBackfillClaim(env.DB, {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
    })
    const message = (error as Error)?.message || String(error)
    log.error('consumer', 'backfill_day_fetch failed', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `date=${job.collectionDate} error=${message} total_ms=${elapsedMs(startedAt)}`,
    })
    throw error
  }
}

async function handleHistoricalTaskJob(env: EnvBindings, job: HistoricalTaskExecuteJob): Promise<void> {
  const startedAt = Date.now()
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

  const productCap = maxProductsPerLender(env)

  log.info('consumer', 'historical_task_execute started', {
    runId: job.runId,
    lenderCode: task.lender_code,
    context:
      `task_id=${task.task_id} date=${task.collection_date} scope=${scope}` +
      ` run_source=${run.run_source} trigger=${run.trigger_source}` +
      ` claim_ttl=${claimTtl} attempt=${job.attempt} idempotency=${job.idempotencyKey}`,
  })

  try {
    const endpointDiscoveryStartedAt = Date.now()
    const endpointCandidates: string[] = []
    const endpoint = await getCachedEndpoint(env.DB, task.lender_code)
    if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
    if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
    const discovered = await discoverProductsEndpoint(lender)
    if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
    const uniqueEndpointCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))
    const endpointHosts = uniqueEndpointCandidates
      .map((value) => {
        try {
          return new URL(value).host
        } catch {
          return value
        }
      })
      .join(',')
    const endpointDiscoveryMs = elapsedMs(endpointDiscoveryStartedAt)

    log.info('consumer', 'historical_task_execute collect', {
      runId: job.runId,
      lenderCode: task.lender_code,
      context:
        `task_id=${task.task_id} date=${task.collection_date} scope=${scope}` +
        ` endpoints=${uniqueEndpointCandidates.length}` +
        ` endpoint_hosts=${endpointHosts || 'none'}` +
        ` seeds=${Math.min(2, lender.seed_rate_urls.length)} product_cap=${productCap}` +
        ` discovery_ms=${endpointDiscoveryMs}`,
    })

    const collectStartedAt = Date.now()
    const collected = await collectHistoricalDayFromWayback({
      lender,
      collectionDate: task.collection_date,
      endpointCandidates: uniqueEndpointCandidates,
      productCap,
      maxSeedUrls: 2,
    })
    const collectMs = elapsedMs(collectStartedAt)
    const payloadStatusSummary = summarizeStatusCodes(collected.payloads.map((payload) => payload.status))
    log.info('consumer', 'historical_task_execute collect_result', {
      runId: job.runId,
      lenderCode: task.lender_code,
      context:
        `task_id=${task.task_id} payloads=${collected.payloads.length}` +
        ` statuses=${serializeForLog(payloadStatusSummary)}` +
        ` parsed(m=${collected.mortgageRows.length},s=${collected.savingsRows.length},td=${collected.tdRows.length})` +
        ` had_wayback_signals=${collected.hadSignals ? 1 : 0}` +
        ` counters(cdx=${collected.counters.cdx_requests},snap=${collected.counters.snapshot_requests})` +
        ` collect_ms=${collectMs}`,
    })

    const payloadPersistStartedAt = Date.now()
    for (const payload of collected.payloads) {
      await persistRawPayload(env, {
        sourceType: 'wayback_html',
        sourceUrl: payload.sourceUrl,
        payload: payload.payload,
        httpStatus: payload.status,
        notes: `${payload.notes} run=${job.runId} task=${task.task_id} scope=${scope}`,
      })
    }
    const payloadPersistMs = elapsedMs(payloadPersistStartedAt)

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

    const validateStartedAt = Date.now()
    const { accepted: mortgageAccepted, dropped: mortgageDropped } = splitValidatedRows(mortgageRows)
    const { accepted: savingsAccepted, dropped: savingsDropped } = splitValidatedSavingsRows(savingsRows)
    const { accepted: tdAccepted, dropped: tdDropped } = splitValidatedTdRows(tdRows)
    const mortgageDroppedReasons = summarizeDropReasons(mortgageDropped)
    const savingsDroppedReasons = summarizeDropReasons(savingsDropped)
    const tdDroppedReasons = summarizeDropReasons(tdDropped)
    const validateMs = elapsedMs(validateStartedAt)
    log.info('consumer', 'historical_task_execute validation', {
      runId: job.runId,
      lenderCode: task.lender_code,
      context:
        `task_id=${task.task_id}` +
        ` accepted(m=${mortgageAccepted.length},s=${savingsAccepted.length},td=${tdAccepted.length})` +
        ` dropped(m=${mortgageDropped.length},s=${savingsDropped.length},td=${tdDropped.length})` +
        ` reasons(m=${serializeForLog(mortgageDroppedReasons)},s=${serializeForLog(savingsDroppedReasons)},td=${serializeForLog(tdDroppedReasons)})` +
        ` validate_ms=${validateMs}`,
    })

    const writeStartedAt = Date.now()
    const [mortgageWritten, savingsWritten, tdWritten] = await Promise.all([
      upsertHistoricalRateRows(env.DB, mortgageAccepted),
      upsertSavingsRateRows(env.DB, savingsAccepted),
      upsertTdRateRows(env.DB, tdAccepted),
    ])
    const writeMs = elapsedMs(writeStartedAt)

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
        accepted_counts: {
          mortgage_rows: mortgageAccepted.length,
          savings_rows: savingsAccepted.length,
          td_rows: tdAccepted.length,
        },
        dropped_counts: {
          mortgage_rows: mortgageDropped.length,
          savings_rows: savingsDropped.length,
          td_rows: tdDropped.length,
        },
        dropped_reasons: {
          mortgage: mortgageDroppedReasons,
          savings: savingsDroppedReasons,
          term_deposits: tdDroppedReasons,
        },
        written_counts: {
          mortgage_rows: mortgageWritten,
          savings_rows: savingsWritten,
          td_rows: tdWritten,
        },
        had_signals: hadSignals,
        had_wayback_signals: collected.hadSignals,
        counters: collected.counters,
        payload_count: collected.payloads.length,
        payload_statuses: payloadStatusSummary,
        endpoint_candidates: uniqueEndpointCandidates,
        timing: {
          endpointDiscoveryMs,
          collectMs,
          payloadPersistMs,
          validateMs,
          writeMs,
          totalMs: elapsedMs(startedAt),
        },
        captured_at: nowIso(),
      },
      httpStatus: 200,
      notes: `historical_task_summary lender=${task.lender_code} date=${task.collection_date} scope=${scope}`,
    })

    const historicalParsedTotal = mortgageRows.length + savingsRows.length + tdRows.length
    const historicalWrittenTotal = mortgageWritten + savingsWritten + tdWritten
    const historicalShouldWarn = historicalWrittenTotal === 0

    if (historicalParsedTotal === 0 && historicalWrittenTotal === 0) {
      log.warn('consumer', 'historical_task_execute empty_result', {
        runId: job.runId,
        lenderCode: task.lender_code,
        context:
          `task_id=${task.task_id} date=${task.collection_date} scope=${scope}` +
          ` endpoints=${uniqueEndpointCandidates.length}` +
          ` had_wayback_signals=${collected.hadSignals ? 1 : 0}` +
          ` counters(cdx=${collected.counters.cdx_requests},snap=${collected.counters.snapshot_requests})`,
      })
    }

    const historicalCompletionContext =
      `task_id=${task.task_id} date=${task.collection_date} scope=${scope}` +
      ` parsed(m=${mortgageRows.length},s=${savingsRows.length},td=${tdRows.length})` +
      ` accepted(m=${mortgageAccepted.length},s=${savingsAccepted.length},td=${tdAccepted.length})` +
      ` dropped(m=${mortgageDropped.length},s=${savingsDropped.length},td=${tdDropped.length})` +
      ` written(m=${mortgageWritten},s=${savingsWritten},td=${tdWritten})` +
      ` reasons(m=${serializeForLog(mortgageDroppedReasons)},s=${serializeForLog(savingsDroppedReasons)},td=${serializeForLog(tdDroppedReasons)})` +
      ` signals(wayback=${collected.hadSignals ? 1 : 0},final=${hadSignals ? 1 : 0})` +
      ` counters(cdx=${collected.counters.cdx_requests},snap=${collected.counters.snapshot_requests},payloads=${collected.payloads.length})` +
      ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectMs},payload_persist=${payloadPersistMs},validate=${validateMs},write=${writeMs},total=${elapsedMs(startedAt)}`

    if (historicalShouldWarn) {
      log.warn('consumer', 'historical_task_execute completed', {
        runId: job.runId,
        lenderCode: task.lender_code,
        context: `${historicalCompletionContext} completion=warn_no_writes`,
      })
    } else {
      log.info('consumer', 'historical_task_execute completed', {
        runId: job.runId,
        lenderCode: task.lender_code,
        context: historicalCompletionContext,
      })
    }
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
      context: `task_id=${task.task_id} date=${task.collection_date} error=${message} total_ms=${elapsedMs(startedAt)}`,
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
    log.info('consumer', 'historical_task_execute coverage_recorded', {
      runId: runAfter.run_id,
      lenderCode: task.lender_code,
      context:
        `task_id=${task.task_id} dataset=${coverageDataset}` +
        ` run_status=${runAfter.status} rows=${rowsWrittenForScope(scope, runAfter)}`,
    })
  } else {
    log.debug('consumer', 'historical_task_execute coverage_skipped', {
      runId: job.runId,
      lenderCode: task.lender_code,
      context:
        `task_id=${task.task_id} dataset=${coverageDataset ?? 'none'}` +
        ` run_after=${runAfter ? runAfter.status : 'missing'}` +
        ` run_source=${runAfter ? runAfter.run_source : 'missing'}`,
    })
  }
}

async function handleDailySavingsLenderJob(env: EnvBindings, job: DailySavingsLenderJob): Promise<void> {
  const startedAt = Date.now()
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) throw new Error(`unknown_lender_code:${job.lenderCode}`)
  log.info('consumer', `daily_savings_lender_fetch started`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} run_source=${job.runSource ?? 'scheduled'}` +
      ` attempt=${job.attempt} idempotency=${job.idempotencyKey}`,
  })

  const playbook = getLenderPlaybook(lender)
  const endpointDiscoveryStartedAt = Date.now()
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const endpointCandidates: string[] = []
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))
  const endpointHosts = summarizeEndpointHosts(uniqueCandidates)
  const endpointDiscoveryMs = elapsedMs(endpointDiscoveryStartedAt)

  const savingsRows: NormalizedSavingsRow[] = []
  const tdRows: NormalizedTdRow[] = []
  const productCap = maxProductsPerLender(env)
  let endpointsTried = 0
  let indexPayloads = 0
  let savingsProductIdsDiscovered = 0
  let tdProductIdsDiscovered = 0
  let savingsDetailRequests = 0
  let tdDetailRequests = 0
  let savingsRemovalSyncProductIds: string[] | null = null
  let tdRemovalSyncProductIds: string[] | null = null
  const endpointDiagnostics: Array<Record<string, unknown>> = []
  let collectionMs = 0
  let validationMs = 0
  let writeMs = 0
  const syncRemovalStatus = async (): Promise<void> => {
    const bankName = lender.canonical_bank_name || lender.name
    if (savingsRemovalSyncProductIds != null) {
      const started = Date.now()
      const seenTouched = await markProductsSeen(env.DB, {
        section: 'savings',
        bankName,
        productIds: savingsRemovalSyncProductIds,
        collectionDate: job.collectionDate,
        runId: job.runId,
      })
      const removedTouched = await markMissingProductsRemoved(env.DB, {
        section: 'savings',
        bankName,
        activeProductIds: savingsRemovalSyncProductIds,
      })
      log.info('consumer', 'daily_savings_lender_fetch removal_sync_savings', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `bank=${bankName} discovered=${savingsRemovalSyncProductIds.length}` +
          ` seen_touched=${seenTouched} removed_touched=${removedTouched}` +
          ` elapsed_ms=${elapsedMs(started)}`,
      })
    } else {
      log.info('consumer', 'daily_savings_lender_fetch removal_sync_savings_skipped', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context: 'reason=no_successful_cdr_index_fetch',
      })
    }

    if (tdRemovalSyncProductIds != null) {
      const started = Date.now()
      const seenTouched = await markProductsSeen(env.DB, {
        section: 'term_deposits',
        bankName,
        productIds: tdRemovalSyncProductIds,
        collectionDate: job.collectionDate,
        runId: job.runId,
      })
      const removedTouched = await markMissingProductsRemoved(env.DB, {
        section: 'term_deposits',
        bankName,
        activeProductIds: tdRemovalSyncProductIds,
      })
      log.info('consumer', 'daily_savings_lender_fetch removal_sync_td', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `bank=${bankName} discovered=${tdRemovalSyncProductIds.length}` +
          ` seen_touched=${seenTouched} removed_touched=${removedTouched}` +
          ` elapsed_ms=${elapsedMs(started)}`,
      })
    } else {
      log.info('consumer', 'daily_savings_lender_fetch removal_sync_td_skipped', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context: 'reason=no_successful_cdr_index_fetch',
      })
    }
  }

  log.info('consumer', 'daily_savings_lender_fetch collect', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} endpoints=${uniqueCandidates.length}` +
      ` endpoint_hosts=${endpointHosts || 'none'} product_cap=${productCap}` +
      ` discovery_ms=${endpointDiscoveryMs}`,
  })

  const collectStartedAt = Date.now()
  for (const [endpointIndex, candidateEndpoint] of uniqueCandidates.entries()) {
    const endpointStartedAt = Date.now()
    endpointsTried += 1
    log.info('consumer', 'daily_savings_lender_fetch endpoint_attempt', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `endpoint_idx=${endpointIndex + 1}/${uniqueCandidates.length}` +
        ` endpoint=${shortUrlForLog(candidateEndpoint)}`,
    })
    const [savingsProducts, tdProducts] = await Promise.all([
      fetchSavingsProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions }),
      fetchTermDepositProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions }),
    ])
    savingsProductIdsDiscovered += savingsProducts.productIds.length
    tdProductIdsDiscovered += tdProducts.productIds.length
    indexPayloads += savingsProducts.rawPayloads.length + tdProducts.rawPayloads.length
    const savingsIndexStatuses = summarizeStatusCodes(savingsProducts.rawPayloads.map((payload) => payload.status))
    const tdIndexStatuses = summarizeStatusCodes(tdProducts.rawPayloads.map((payload) => payload.status))
    const savingsIndexFetchSucceeded =
      savingsProducts.rawPayloads.length > 0 &&
      savingsProducts.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (savingsIndexFetchSucceeded && savingsRemovalSyncProductIds == null) {
      savingsRemovalSyncProductIds = savingsProducts.productIds.slice()
    }
    const tdIndexFetchSucceeded =
      tdProducts.rawPayloads.length > 0 && tdProducts.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (tdIndexFetchSucceeded && tdRemovalSyncProductIds == null) {
      tdRemovalSyncProductIds = tdProducts.productIds.slice()
    }
    const savingsRowsBefore = savingsRows.length
    const tdRowsBefore = tdRows.length
    const savingsDetailStatuses: number[] = []
    const tdDetailStatuses: number[] = []
    let savingsDetailRows = 0
    let tdDetailRows = 0

    for (const payload of [...savingsProducts.rawPayloads, ...tdProducts.rawPayloads]) {
      await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        notes: `savings_td_product_index lender=${job.lenderCode}`,
      })
    }

    const savingsProductIds = savingsProducts.productIds.slice(0, productCap)
    savingsDetailRequests += savingsProductIds.length
    for (const productId of savingsProductIds) {
      const detailStartedAt = Date.now()
      const details = await fetchSavingsProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })
      savingsDetailStatuses.push(details.rawPayload.status)
      savingsDetailRows += details.savingsRows.length
      await persistProductDetailPayload(env, job.runSource, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `savings_product_detail lender=${job.lenderCode} product=${productId}`,
      })
      for (const row of details.savingsRows) savingsRows.push(row)
      if (details.savingsRows.length === 0) {
        log.debug('consumer', 'daily_savings_lender_fetch savings_detail_empty', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `endpoint=${shortUrlForLog(candidateEndpoint)} product=${productId}` +
            ` status=${details.rawPayload.status} elapsed_ms=${elapsedMs(detailStartedAt)}`,
        })
      }
    }

    const tdProductIds = tdProducts.productIds.slice(0, productCap)
    tdDetailRequests += tdProductIds.length
    for (const productId of tdProductIds) {
      const detailStartedAt = Date.now()
      const details = await fetchTdProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })
      tdDetailStatuses.push(details.rawPayload.status)
      tdDetailRows += details.tdRows.length
      await persistProductDetailPayload(env, job.runSource, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `td_product_detail lender=${job.lenderCode} product=${productId}`,
      })
      for (const row of details.tdRows) tdRows.push(row)
      if (details.tdRows.length === 0) {
        log.debug('consumer', 'daily_savings_lender_fetch td_detail_empty', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `endpoint=${shortUrlForLog(candidateEndpoint)} product=${productId}` +
            ` status=${details.rawPayload.status} elapsed_ms=${elapsedMs(detailStartedAt)}`,
        })
      }
    }

    const endpointSummary = {
      endpoint: candidateEndpoint,
      savings_index_payloads: savingsProducts.rawPayloads.length,
      td_index_payloads: tdProducts.rawPayloads.length,
      savings_index_statuses: savingsIndexStatuses,
      td_index_statuses: tdIndexStatuses,
      savings_ids_discovered: savingsProducts.productIds.length,
      td_ids_discovered: tdProducts.productIds.length,
      savings_ids_used: savingsProductIds.length,
      td_ids_used: tdProductIds.length,
      savings_ids_sample: summarizeProductSample(savingsProducts.productIds),
      td_ids_sample: summarizeProductSample(tdProducts.productIds),
      savings_detail_statuses: summarizeStatusCodes(savingsDetailStatuses),
      td_detail_statuses: summarizeStatusCodes(tdDetailStatuses),
      savings_detail_rows: savingsDetailRows,
      td_detail_rows: tdDetailRows,
      savings_rows_collected: savingsRows.length - savingsRowsBefore,
      td_rows_collected: tdRows.length - tdRowsBefore,
      elapsed_ms: elapsedMs(endpointStartedAt),
    }
    endpointDiagnostics.push(endpointSummary)
    log.info('consumer', 'daily_savings_lender_fetch endpoint_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `endpoint_idx=${endpointIndex + 1}/${uniqueCandidates.length}` +
        ` endpoint=${shortUrlForLog(candidateEndpoint)}` +
        ` index_payloads(s=${savingsProducts.rawPayloads.length},td=${tdProducts.rawPayloads.length})` +
        ` index_statuses(s=${serializeForLog(savingsIndexStatuses)},td=${serializeForLog(tdIndexStatuses)})` +
        ` product_ids(s=${savingsProducts.productIds.length},td=${tdProducts.productIds.length})` +
        ` used(s=${savingsProductIds.length},td=${tdProductIds.length})` +
        ` detail_rows(s=${savingsDetailRows},td=${tdDetailRows})` +
        ` collected(s=${savingsRows.length - savingsRowsBefore},td=${tdRows.length - tdRowsBefore})` +
        ` detail_statuses(s=${serializeForLog(summarizeStatusCodes(savingsDetailStatuses))},td=${serializeForLog(
          summarizeStatusCodes(tdDetailStatuses),
        )})` +
        ` elapsed_ms=${endpointSummary.elapsed_ms}`,
    })

    if (savingsRows.length > 0 || tdRows.length > 0) break
  }
  collectionMs = elapsedMs(collectStartedAt)

  const validateStartedAt = Date.now()
  const { accepted: savingsAccepted, dropped: savingsDropped } = splitValidatedSavingsRows(savingsRows)
  const savingsDroppedReasons = summarizeDropReasons(savingsDropped)
  const { accepted: tdAccepted, dropped: tdDropped } = splitValidatedTdRows(tdRows)
  const tdDroppedReasons = summarizeDropReasons(tdDropped)
  validationMs = elapsedMs(validateStartedAt)

  log.info('consumer', 'daily_savings_lender_fetch validation', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `savings(collected=${savingsRows.length},accepted=${savingsAccepted.length},dropped=${savingsDropped.length})` +
      ` td(collected=${tdRows.length},accepted=${tdAccepted.length},dropped=${tdDropped.length})` +
      ` reasons(s=${serializeForLog(savingsDroppedReasons)},td=${serializeForLog(tdDroppedReasons)})` +
      ` dropped_samples(s=${summarizeProductSample(savingsDropped.map((item) => item.productId))},td=${summarizeProductSample(
        tdDropped.map((item) => item.productId),
      )})` +
      ` validation_ms=${validationMs}`,
  })

  for (const row of savingsAccepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  for (const row of tdAccepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }

  const writeStartedAt = Date.now()
  const [savingsWritten, tdWritten] = await Promise.all([
    savingsAccepted.length > 0 ? upsertSavingsRateRows(env.DB, savingsAccepted) : Promise.resolve(0),
    tdAccepted.length > 0 ? upsertTdRateRows(env.DB, tdAccepted) : Promise.resolve(0),
  ])
  writeMs = elapsedMs(writeStartedAt)
  await syncRemovalStatus()

  log.info('consumer', 'daily_savings_lender_fetch write_completed', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context: `written(s=${savingsWritten},td=${tdWritten}) write_ms=${writeMs}`,
  })

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
        written: savingsWritten,
        reasons: savingsDroppedReasons,
      },
      term_deposits: {
        inspected: tdRows.length,
        accepted: tdAccepted.length,
        dropped: tdDropped.length,
        written: tdWritten,
        reasons: tdDroppedReasons,
      },
      collection: {
        endpointsTried,
        indexPayloads,
        savingsProductIdsDiscovered,
        tdProductIdsDiscovered,
        savingsDetailRequests,
        tdDetailRequests,
      },
      endpointDiagnostics,
      timing: {
        endpointDiscoveryMs,
        collectionMs,
        validationMs,
        writeMs,
        totalMs: elapsedMs(startedAt),
      },
      source_mix: {
        [job.runSource ?? 'scheduled']: savingsAccepted.length + tdAccepted.length,
      },
    },
    httpStatus: 200,
    notes: `savings_td_quality_summary lender=${job.lenderCode}`,
  })

  const savingsParsedTotal = savingsRows.length + tdRows.length
  const savingsWrittenTotal = savingsWritten + tdWritten
  const savingsShouldWarn = savingsWrittenTotal === 0

  if (savingsParsedTotal === 0 && savingsWrittenTotal === 0) {
    log.warn('consumer', 'daily_savings_lender_fetch empty_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
        ` product_ids(s=${savingsProductIdsDiscovered},td=${tdProductIdsDiscovered})` +
        ` detail_requests(s=${savingsDetailRequests},td=${tdDetailRequests})` +
        ` endpoint_diagnostics=${serializeForLog(endpointDiagnostics)}` +
        ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},validate=${validationMs},write=${writeMs},total=${elapsedMs(startedAt)}`,
    })
  }

  const savingsCompletionContext =
    `savings=${savingsAccepted.length}/${savingsRows.length} dropped=${savingsDropped.length} written=${savingsWritten}` +
    ` td=${tdAccepted.length}/${tdRows.length} dropped=${tdDropped.length} written=${tdWritten}` +
    ` reasons(s=${JSON.stringify(savingsDroppedReasons)},td=${JSON.stringify(tdDroppedReasons)})` +
    ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
    ` product_ids(s=${savingsProductIdsDiscovered},td=${tdProductIdsDiscovered})` +
    ` detail_requests(s=${savingsDetailRequests},td=${tdDetailRequests})` +
    ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},validate=${validationMs},write=${writeMs},total=${elapsedMs(startedAt)}`

  if (savingsShouldWarn) {
    log.warn('consumer', `daily_savings_lender_fetch completed`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `${savingsCompletionContext} completion=warn_no_writes`,
    })
  } else {
    log.info('consumer', `daily_savings_lender_fetch completed`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: savingsCompletionContext,
    })
  }
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
  const startedAt = Date.now()
  const maxAttempts = parseIntegerEnv(env.MAX_QUEUE_ATTEMPTS, DEFAULT_MAX_QUEUE_ATTEMPTS)
  const metrics = {
    processed: 0,
    acked: 0,
    retried: 0,
    success: 0,
    failed: 0,
    nonRetryable: 0,
    exhausted: 0,
    invalidShape: 0,
  }
  log.info('consumer', `queue_batch received ${batch.messages.length} messages`, {
    context: `max_attempts=${maxAttempts}`,
  })

  for (const msg of batch.messages) {
    const messageStartedAt = Date.now()
    const attempts = Number(msg.attempts || 1)
    const body = msg.body
    const context = extractRunContext(body)
    const messageKind = isObject(body) && typeof body.kind === 'string' ? body.kind : 'unknown'
    const bodyAttempt = isObject(body) && Number.isFinite(Number(body.attempt)) ? Number(body.attempt) : null
    const idempotencyKey = isObject(body) && typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
    const messageContext =
      `kind=${messageKind}` +
      ` queue_attempt=${attempts}/${maxAttempts}` +
      ` body_attempt=${bodyAttempt ?? 'na'}` +
      ` idempotency=${idempotencyKey ?? 'na'}`

    log.info('consumer', 'queue_message_start', {
      runId: context.runId ?? undefined,
      lenderCode: context.lenderCode ?? undefined,
      context: messageContext,
    })

    try {
      if (!isIngestMessage(body)) {
        metrics.invalidShape += 1
        log.error('consumer', 'invalid_queue_message_shape', {
          context: `${messageContext} body=${serializeForLog(body)}`,
        })
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
      metrics.success += 1
      metrics.acked += 1
      log.info('consumer', 'queue_message_ack', {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
        context: `${messageContext} elapsed_ms=${elapsedMs(messageStartedAt)}`,
      })
    } catch (error) {
      metrics.failed += 1
      const errorMessage = (error as Error)?.message || String(error)
      log.error('consumer', `queue_message_failed attempt=${attempts}/${maxAttempts}: ${errorMessage}`, {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
        context: `${messageContext} elapsed_ms=${elapsedMs(messageStartedAt)}`,
      })

      if (isNonRetryableErrorMessage(errorMessage)) {
        metrics.nonRetryable += 1
        log.warn('consumer', 'queue_message_non_retryable', {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: `${messageContext} error=${errorMessage}`,
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
        metrics.acked += 1
        continue
      }

      if (attempts >= maxAttempts) {
        metrics.exhausted += 1
        log.error('consumer', `queue_message_exhausted max_attempts=${maxAttempts}`, {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: `${messageContext} error=${errorMessage}`,
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
        metrics.acked += 1
        continue
      }

      const retryDelaySeconds = calculateRetryDelaySeconds(attempts)
      msg.retry({
        delaySeconds: retryDelaySeconds,
      })
      metrics.retried += 1
      log.warn('consumer', 'queue_message_retry_scheduled', {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
        context:
          `${messageContext} delay_seconds=${retryDelaySeconds}` +
          ` error=${errorMessage} elapsed_ms=${elapsedMs(messageStartedAt)}`,
      })
    } finally {
      metrics.processed += 1
    }
  }

  log.info('consumer', 'queue_batch completed', {
    context:
      `messages=${batch.messages.length} processed=${metrics.processed}` +
      ` acked=${metrics.acked} retried=${metrics.retried}` +
      ` success=${metrics.success} failed=${metrics.failed}` +
      ` non_retryable=${metrics.nonRetryable} exhausted=${metrics.exhausted}` +
      ` invalid_shape=${metrics.invalidShape} total_ms=${elapsedMs(startedAt)}`,
  })
}
