import { TARGET_LENDERS } from '../../../constants'
import {
  ensureLenderDatasetRun,
  markLenderDatasetIndexFetchSucceeded,
  recordLenderDatasetWriteStats,
  setLenderDatasetExpectedDetails,
} from '../../../db/lender-dataset-runs'
import { getActiveCdrProductRefs } from '../../../db/active-cdr-products'
import { addRunEnqueuedCounts } from '../../../db/run-progress'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { persistRawPayload } from '../../../db/raw-payloads'
import { cdrCollectionNotes, discoverProductsEndpoint, fetchResidentialMortgageProductIds } from '../../../ingest/cdr'
import { AMP_MORTGAGE_VARIABLES_URL, parseAmpMortgageVariables } from '../../../ingest/amp-mortgage-variables'
import { candidateProductEndpoints } from '../../../ingest/product-endpoints'
import { parseGreatSouthernHomeLoanRatesFromHtml } from '../../../ingest/great-southern-html'
import { enqueueLenderFinalizeJobs, enqueueProductDetailJobs } from '../../producer'
import { extractLenderRatesFromHtml } from '../../../ingest/html-rate-parser'
import { getLenderPlaybook } from '../../../ingest/lender-playbooks'
import type { DailyLenderJob, EnvBindings } from '../../../types'
import { FetchWithTimeoutError, fetchJsonWithTimeout, fetchWithTimeout, hostFromUrl } from '../../../utils/fetch-with-timeout'
import { log } from '../../../utils/logger'
import { detectUpstreamBlock } from '../../../utils/upstream-block'
import { nowIso } from '../../../utils/time'
import { recordDroppedAnomalies } from '../anomalies'
import { finalizeLenderDatasetIfReady } from '../finalization'
import { elapsedMs, serializeForLog, shortUrlForLog, summarizeDropReasons, summarizeEndpointHosts, summarizeProductSample, summarizeStatusCodes } from '../log-helpers'
import { maxCdrProductPages } from '../retry-config'
import { bankNameForLender, markHomeLoanSeriesSeenForRun, markProductsSeenForRun } from '../series-tracking'
import { shouldSoftFailNoSignals } from '../soft-fail-no-signals'
import { splitValidatedRows } from '../validation'

export { shouldSoftFailNoSignals } from '../soft-fail-no-signals'

export function shouldShortCircuitAfterHomeLoanIndexFetch(input: {
  lenderCode?: string
  successfulIndexFetch: boolean
  discoveredProductCount: number
}): boolean {
  return input.successfulIndexFetch && input.discoveredProductCount > 0 && input.lenderCode !== 'great_southern'
}

export async function handleDailyLenderJob(env: EnvBindings, job: DailyLenderJob): Promise<void> {
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
  const bankName = bankNameForLender(lender)
  await ensureLenderDatasetRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    bankName,
    collectionDate: job.collectionDate,
  })
  const endpointDiscoveryStartedAt = Date.now()
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  let sourceUrl = ''
  const discovered = await discoverProductsEndpoint(lender, {
    env,
    runId: job.runId,
    lenderCode: job.lenderCode,
  })
  const uniqueCandidates = candidateProductEndpoints({
    cachedEndpointUrl: endpoint?.endpointUrl,
    lender,
    discoveredEndpointUrl: discovered?.endpointUrl,
  })
  const endpointHosts = summarizeEndpointHosts(uniqueCandidates)
  const endpointDiscoveryMs = elapsedMs(endpointDiscoveryStartedAt)

  const collectedRows: Parameters<typeof splitValidatedRows>[0] = []
  let inspectedHtml = 0
  let droppedByParser = 0
  let endpointsTried = 0
  let indexPayloads = 0
  let detailJobsEnqueued = 0
  let catalogSupplements = 0
  const discoveredProductEndpointMap = new Map<string, string>()
  const discoveredProductFallbackFetchEventIdMap = new Map<string, number>()
  let successfulIndexFetch = false
  let fallbackSeedFetches = 0
  const observedUpstreamStatuses: number[] = []
  const observedUpstreamBlocks: Array<{ sourceUrl: string; status: number; reasonCode: string; fetchEventId: number | null }> = []
  const endpointDiagnostics: Array<Record<string, unknown>> = []
  const seedDiagnostics: Array<Record<string, unknown>> = []
  let collectionMs = 0
  let validationMs = 0
  let writeMs = 0

  log.info('consumer', 'daily_lender_fetch collect', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} endpoints=${uniqueCandidates.length}` +
      ` endpoint_hosts=${endpointHosts || 'none'}` +
      ` seeds=${Math.min(2, lender.seed_rate_urls.length)}` +
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
    const products = await fetchResidentialMortgageProductIds(candidateEndpoint, maxCdrProductPages(), {
      cdrVersions: playbook.cdrVersions,
      env,
      runId: job.runId,
      lenderCode: job.lenderCode,
    })
    for (const payload of products.rawPayloads) {
      observedUpstreamStatuses.push(payload.status)
    }
    indexPayloads += products.rawPayloads.length
    const endpointIds = Array.from(new Set(products.productIds)).filter(Boolean)
    const indexStatusSummary = summarizeStatusCodes(products.rawPayloads.map((payload) => payload.status))
    const indexFetchSucceeded =
      products.rawPayloads.length > 0 && products.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (products.pageLimitHit) {
      log.error('consumer', 'daily_lender_fetch index_page_limit_hit', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `endpoint=${shortUrlForLog(candidateEndpoint)} pages=${products.pagesFetched}` +
          ` next=${products.nextUrl || 'none'} discovered=${products.productIds.length}`,
      })
    }
    let endpointFallbackFetchEventId: number | null = null
    for (const payload of products.rawPayloads) {
      const upstreamBlock = detectUpstreamBlock({
        status: payload.status,
        body: payload.body,
      })
      const persisted = await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        jobKind: 'daily_home_index_fetch',
        collectionDate: job.collectionDate,
        notes:
          `daily_product_index lender=${job.lenderCode}` +
          (upstreamBlock.reasonCode ? ` reason=${upstreamBlock.reasonCode}` : ''),
      })
      if (endpointFallbackFetchEventId == null && persisted.fetchEventId != null) {
        endpointFallbackFetchEventId = persisted.fetchEventId
      }
      if (upstreamBlock.reasonCode) {
        observedUpstreamBlocks.push({
          sourceUrl: payload.sourceUrl,
          status: payload.status,
          reasonCode: upstreamBlock.reasonCode,
          fetchEventId: persisted.fetchEventId ?? null,
        })
        log.warn('consumer', 'daily_lender_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `endpoint=${shortUrlForLog(candidateEndpoint)} source=${shortUrlForLog(payload.sourceUrl)}` +
            ` status=${payload.status} reason=${upstreamBlock.reasonCode}` +
            ` marker=${upstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${persisted.fetchEventId ?? 'none'}`,
        })
      }
    }
    if (indexFetchSucceeded) {
      successfulIndexFetch = true
      for (const productId of endpointIds) {
        discoveredProductEndpointMap.set(productId, candidateEndpoint)
        if (endpointFallbackFetchEventId != null) {
          discoveredProductFallbackFetchEventIdMap.set(productId, endpointFallbackFetchEventId)
        }
      }
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        bankName,
        collectionDate: job.collectionDate,
        productIds: endpointIds,
      })
    }
    const endpointElapsedMs = elapsedMs(endpointStartedAt)
    const endpointSummary = {
      endpoint: candidateEndpoint,
      index_payloads: products.rawPayloads.length,
      index_statuses: indexStatusSummary,
      upstream_blocks: observedUpstreamBlocks.filter((item) => item.sourceUrl.startsWith(candidateEndpoint)).length,
      product_ids_discovered: endpointIds.length,
      product_ids_sample: summarizeProductSample(endpointIds),
      detail_jobs_planned: endpointIds.length,
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
        ` upstream_blocks=${endpointSummary.upstream_blocks}` +
        ` discovered=${endpointIds.length}` +
        ` sample_products=${summarizeProductSample(endpointIds)}` +
        ` detail_jobs_planned=${endpointIds.length}` +
        ` elapsed_ms=${endpointElapsedMs}`,
    })
    if (indexFetchSucceeded && !sourceUrl) {
      sourceUrl = candidateEndpoint
    }
  }

  collectionMs = elapsedMs(collectionStartedAt)

  if (successfulIndexFetch) {
    const refs = await getActiveCdrProductRefs(env.DB, { dataset: 'home_loans', bankName })
    for (const ref of refs) {
      if (discoveredProductEndpointMap.has(ref.productId)) continue
      discoveredProductEndpointMap.set(ref.productId, ref.endpointUrl)
      catalogSupplements += 1
    }
  }

  const productIds = Array.from(discoveredProductEndpointMap.keys())
  const useCdrDetailFanout = shouldShortCircuitAfterHomeLoanIndexFetch({
    lenderCode: job.lenderCode,
    successfulIndexFetch,
    discoveredProductCount: productIds.length,
  })
  if (successfulIndexFetch && useCdrDetailFanout) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      bankName,
      collectionDate: job.collectionDate,
      expectedDetailCount: productIds.length,
    })
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
  }

  if (successfulIndexFetch && !useCdrDetailFanout) {
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
    log.info('consumer', 'daily_lender_fetch html_fallback_preferred', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} discovered_products=${productIds.length}` +
        ` reason=structured_html_fallback_preferred`,
    })
  }

  if (useCdrDetailFanout) {
    const endpointUrlByProductId = Object.fromEntries(
      Array.from(discoveredProductEndpointMap.entries()).map(([productId, endpointUrl]) => [productId, endpointUrl]),
    )
    const fallbackFetchEventIdByProductId = Object.fromEntries(
      Array.from(discoveredProductFallbackFetchEventIdMap.entries()).map(([productId, fetchEventId]) => [productId, fetchEventId]),
    )
    const detailEnqueue =
      productIds.length > 0
        ? await enqueueProductDetailJobs(env, {
            runId: job.runId,
            runSource: job.runSource,
            lenderCode: job.lenderCode,
            dataset: 'home_loans',
            collectionDate: job.collectionDate,
            productIds,
            endpointUrlByProductId,
            fallbackFetchEventIdByProductId,
          })
        : { enqueued: 0 }
    const finalizerEnqueue = await enqueueLenderFinalizeJobs(env, {
      runId: job.runId,
      runSource: job.runSource,
      lenderCode: job.lenderCode,
      collectionDate: job.collectionDate,
      datasets: ['home_loans'],
    })
    detailJobsEnqueued = detailEnqueue.enqueued
    await addRunEnqueuedCounts(env.DB, job.runId, {
      [job.lenderCode]: detailEnqueue.enqueued + finalizerEnqueue.enqueued,
    })
    await persistRawPayload(env, {
      sourceType: 'cdr_products',
      sourceUrl: sourceUrl || `summary://${job.lenderCode}/home-loans`,
      payload: {
        lenderCode: job.lenderCode,
        runId: job.runId,
        collectionDate: job.collectionDate,
        fetchedAt: nowIso(),
        acceptedRows: 0,
        rejectedRows: 0,
        discoveredProducts: productIds.length,
        detailJobsEnqueued,
        collection: {
          endpointsTried,
          indexPayloads,
          catalogSupplements,
          productIdsDiscovered: productIds.length,
        },
        upstreamBlocks: {
          count: observedUpstreamBlocks.length,
          fetchEventIds: observedUpstreamBlocks.map((item) => item.fetchEventId).filter((id) => id != null),
          reasons: Array.from(new Set(observedUpstreamBlocks.map((item) => item.reasonCode))),
        },
        endpointDiagnostics,
        timings: {
          endpointDiscoveryMs,
          collectionMs,
          totalMs: elapsedMs(jobStartedAt),
        },
      },
      httpStatus: 202,
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      jobKind: 'daily_home_index_fetch',
      collectionDate: job.collectionDate,
      notes: cdrCollectionNotes(productIds.length, 0),
    })
    log.info('consumer', 'daily_lender_fetch enqueued_detail_jobs', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `products=${productIds.length} detail_jobs=${detailEnqueue.enqueued}` +
        ` catalog_supplements=${catalogSupplements}` +
        ` finalizer_jobs=${finalizerEnqueue.enqueued}` +
        ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
        ` upstream_blocks=${observedUpstreamBlocks.length}` +
        ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},total=${elapsedMs(jobStartedAt)}`,
    })
    return
  }

  if (collectedRows.length === 0) {
    let ampVariablePayload: unknown = null
    let ampVariableDiagnostics: {
      endpoint: string
      status: number
      elapsed_ms: number
      attempts: number
    } | null = null
    if (lender.code === 'amp') {
      try {
        const fetched = await fetchJsonWithTimeout(
          AMP_MORTGAGE_VARIABLES_URL,
          {
            headers: {
              Accept: 'application/json',
            },
          },
          { env },
        )
        ampVariableDiagnostics = {
          endpoint: AMP_MORTGAGE_VARIABLES_URL,
          status: fetched.response.status,
          elapsed_ms: fetched.meta.elapsed_ms,
          attempts: fetched.meta.attempts,
        }
        if (fetched.response.ok) {
          ampVariablePayload = fetched.json
        } else {
          log.warn('consumer', 'daily_lender_fetch amp_variable_feed_unavailable', {
            runId: job.runId,
            lenderCode: job.lenderCode,
            context:
              `endpoint=${shortUrlForLog(AMP_MORTGAGE_VARIABLES_URL)}` +
              ` status=${fetched.response.status} elapsed_ms=${fetched.meta.elapsed_ms}` +
              ` attempts=${fetched.meta.attempts}`,
          })
        }
      } catch (error) {
        const meta = error instanceof FetchWithTimeoutError ? error.meta : null
        log.warn('consumer', 'daily_lender_fetch amp_variable_feed_failed', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `endpoint=${shortUrlForLog(AMP_MORTGAGE_VARIABLES_URL)}` +
            ` elapsed_ms=${meta?.elapsed_ms ?? 0}` +
            ` attempts=${meta?.attempts ?? 1}` +
            ` status=${meta?.status ?? 0}`,
        })
      }
    }
    log.info('consumer', 'daily_lender_fetch fallback_html_start', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `seed_count=${Math.min(2, lender.seed_rate_urls.length)}` +
        (ampVariableDiagnostics
          ? ` amp_variables_status=${ampVariableDiagnostics.status}` +
            ` amp_variables_elapsed_ms=${ampVariableDiagnostics.elapsed_ms}`
          : ''),
    })
    for (const seedUrl of lender.seed_rate_urls.slice(0, 2)) {
      const seedStartedAt = Date.now()
      fallbackSeedFetches += 1
      let response: Response
      let html = ''
      try {
        const fetched = await fetchWithTimeout(seedUrl, undefined, { env })
        response = fetched.response
        html = await response.text()
        observedUpstreamStatuses.push(response.status)
        log.info('consumer', 'upstream_fetch', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `source=fallback_seed host=${hostFromUrl(seedUrl)}` +
            ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
            ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
            ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
            ` status=${fetched.meta.status ?? response.status}`,
        })
      } catch (error) {
        const meta = error instanceof FetchWithTimeoutError ? error.meta : null
        log.warn('consumer', 'upstream_fetch', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `source=fallback_seed host=${hostFromUrl(seedUrl)}` +
            ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
            ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
            ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
            ` status=${meta?.status ?? 0}`,
        })
        throw error
      }
      const seedUpstreamBlock = detectUpstreamBlock({
        status: response.status,
        body: html,
        headers: response.headers,
      })
      const persisted = await persistRawPayload(env, {
        sourceType: 'wayback_html',
        sourceUrl: seedUrl,
        payload: html,
        httpStatus: response.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        jobKind: 'daily_home_index_fetch',
        collectionDate: job.collectionDate,
        notes: `fallback_scrape lender=${job.lenderCode}` + (seedUpstreamBlock.reasonCode ? ` reason=${seedUpstreamBlock.reasonCode}` : ''),
      })
      if (seedUpstreamBlock.reasonCode) {
        observedUpstreamBlocks.push({
          sourceUrl: seedUrl,
          status: response.status,
          reasonCode: seedUpstreamBlock.reasonCode,
          fetchEventId: persisted.fetchEventId ?? null,
        })
        log.warn('consumer', 'daily_lender_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `fallback_seed=${shortUrlForLog(seedUrl)} status=${response.status}` +
            ` reason=${seedUpstreamBlock.reasonCode} marker=${seedUpstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${persisted.fetchEventId ?? 'none'}`,
        })
      }
      const ampVariableParsed =
        ampVariablePayload != null
          ? parseAmpMortgageVariables({
              lender,
              payload: ampVariablePayload,
              sourceUrl: seedUrl,
              collectionDate: job.collectionDate,
              qualityFlag: 'scraped_fallback_strict',
            })
          : null
      const parsed =
        ampVariableParsed && ampVariableParsed.rows.length > 0
          ? {
              rows: ampVariableParsed.rows,
              inspected: ampVariableParsed.inspected,
              dropped: ampVariableParsed.dropped,
            }
          : lender.code === 'great_southern'
            ? (() => {
                const structured = parseGreatSouthernHomeLoanRatesFromHtml({
                  lender,
                  html,
                  sourceUrl: seedUrl,
                  collectionDate: job.collectionDate,
                  qualityFlag: 'scraped_fallback_strict',
                })
                return structured.rows.length > 0
                  ? structured
                  : extractLenderRatesFromHtml({
                      lender,
                      html,
                      sourceUrl: seedUrl,
                      collectionDate: job.collectionDate,
                      mode: 'daily',
                      qualityFlag: 'scraped_fallback_strict',
                    })
              })()
            : extractLenderRatesFromHtml({
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
        row.fetchEventId = persisted.fetchEventId
        collectedRows.push(row)
      }
      const seedSummary = {
        seed_url: seedUrl,
        status: response.status,
        html_bytes: html.length,
        inspected: parsed.inspected,
        parsed_rows: parsed.rows.length,
        dropped: parsed.dropped,
        amp_variable_endpoint: ampVariableDiagnostics?.endpoint ?? null,
        amp_variable_status: ampVariableDiagnostics?.status ?? null,
        amp_variable_rows: ampVariableParsed?.rows.length ?? 0,
        amp_variable_deduped: ampVariableParsed?.deduped ?? 0,
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
          ` amp_variable_rows=${ampVariableParsed?.rows.length ?? 0}` +
          ` amp_variable_deduped=${ampVariableParsed?.deduped ?? 0}` +
          ` elapsed_ms=${seedSummary.elapsed_ms}`,
      })
      if (ampVariableParsed && ampVariableParsed.rows.length > 0) {
        break
      }
    }
  }

  const validationStartedAt = Date.now()
  const { accepted, dropped } = splitValidatedRows(collectedRows)
  const droppedReasons = summarizeDropReasons(dropped)
  const droppedProductsSample = summarizeProductSample(dropped.map((item) => item.productId))
  validationMs = elapsedMs(validationStartedAt)
  await markHomeLoanSeriesSeenForRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    collectionDate: job.collectionDate,
    rows: collectedRows,
  })
  await recordDroppedAnomalies(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    dropped,
  })
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
    const ubankSoftFailNoSignal = shouldSoftFailNoSignals({
      lenderCode: job.lenderCode,
      successfulIndexFetch,
      observedUpstreamStatuses,
    })
    const noMortgageSignals = !hadMortgageSignals || ubankSoftFailNoSignal
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
        ubankSoftFailNoSignal,
        observedUpstreamStatuses,
        upstreamBlocks: observedUpstreamBlocks,
        collection: {
          endpointsTried,
          indexPayloads,
          productIdsDiscovered: productIds.length,
          detailJobsEnqueued,
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
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      jobKind: 'daily_home_index_fetch',
      collectionDate: job.collectionDate,
      notes:
        (noMortgageSignals ? `daily_no_data lender=${job.lenderCode}` : `daily_quality_rejected lender=${job.lenderCode}`) +
        (observedUpstreamBlocks.length > 0 ? ` upstream_blocks=${observedUpstreamBlocks.length}` : ''),
    })
    if (noMortgageSignals) {
      await finalizeLenderDatasetIfReady(env, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
      })
      log.info('consumer', `daily_lender_fetch completed: 0 written, no mortgage signals`, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `collected=0 inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
          ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
          ` ubank_soft_fail=${ubankSoftFailNoSignal ? 1 : 0}` +
          ` statuses=${serializeForLog(observedUpstreamStatuses)}` +
          ` upstream_blocks=${serializeForLog(observedUpstreamBlocks)}` +
          ` detail_jobs=${detailJobsEnqueued}` +
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
        ` upstream_blocks=${serializeForLog(observedUpstreamBlocks)}` +
        ` detail_jobs=${detailJobsEnqueued}` +
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
  await recordLenderDatasetWriteStats(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    acceptedRows: accepted.length,
    writtenRows: written,
    droppedRows: dropped.length,
  })
  log.info('consumer', `daily_lender_fetch completed: ${written} written, ${dropped.length} dropped`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length} written=${written}` +
      ` reasons=${JSON.stringify(droppedReasons)}` +
      ` inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
      ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
      ` upstream_blocks=${observedUpstreamBlocks.length}` +
      ` detail_jobs=${detailJobsEnqueued}` +
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
      upstreamBlocks: observedUpstreamBlocks,
      collection: {
        endpointsTried,
        indexPayloads,
        productIdsDiscovered: productIds.length,
        detailJobsEnqueued,
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
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    jobKind: 'daily_home_index_fetch',
    collectionDate: job.collectionDate,
    notes: cdrCollectionNotes(collectedRows.length, accepted.length),
  })

  if (detailJobsEnqueued === 0) {
    await finalizeLenderDatasetIfReady(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
  }
}
