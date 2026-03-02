import { TARGET_LENDERS } from '../../../constants'
import { ensureLenderDatasetRun, setLenderDatasetExpectedDetails } from '../../../db/lender-dataset-runs'
import { addRunEnqueuedCounts } from '../../../db/run-progress'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { persistRawPayload } from '../../../db/raw-payloads'
import { cdrCollectionNotes, discoverProductsEndpoint, fetchResidentialMortgageProductIds } from '../../../ingest/cdr'
import { enqueueLenderFinalizeJobs, enqueueProductDetailJobs } from '../../producer'
import { extractLenderRatesFromHtml } from '../../../ingest/html-rate-parser'
import { getLenderPlaybook } from '../../../ingest/lender-playbooks'
import type { DailyLenderJob, EnvBindings } from '../../../types'
import { log } from '../../../utils/logger'
import { nowIso } from '../../../utils/time'
import { recordDroppedAnomalies } from '../anomalies'
import { elapsedMs, serializeForLog, shortUrlForLog, summarizeDropReasons, summarizeEndpointHosts, summarizeProductSample, summarizeStatusCodes } from '../log-helpers'
import { maxCdrProductPages } from '../retry-config'
import { bankNameForLender, markHomeLoanSeriesSeenForRun, markProductsSeenForRun } from '../series-tracking'
import { splitValidatedRows } from '../validation'

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
  const endpointCandidates: string[] = []
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))
  const endpointHosts = summarizeEndpointHosts(uniqueCandidates)
  const endpointDiscoveryMs = elapsedMs(endpointDiscoveryStartedAt)

  const collectedRows: Parameters<typeof splitValidatedRows>[0] = []
  let inspectedHtml = 0
  let droppedByParser = 0
  let endpointsTried = 0
  let indexPayloads = 0
  let detailJobsEnqueued = 0
  const discoveredProductIds = new Set<string>()
  let successfulIndexFetch = false
  let fallbackSeedFetches = 0
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
    const products = await fetchResidentialMortgageProductIds(candidateEndpoint, maxCdrProductPages(), { cdrVersions: playbook.cdrVersions })
    indexPayloads += products.rawPayloads.length
    const endpointIds = Array.from(new Set(products.productIds)).filter(Boolean)
    const indexStatusSummary = summarizeStatusCodes(products.rawPayloads.map((payload) => payload.status))
    const indexFetchSucceeded =
      products.rawPayloads.length > 0 && products.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (indexFetchSucceeded) {
      successfulIndexFetch = true
      for (const productId of endpointIds) discoveredProductIds.add(productId)
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        bankName,
        collectionDate: job.collectionDate,
        productIds: endpointIds,
      })
    }
    if (products.pageLimitHit) {
      log.error('consumer', 'daily_lender_fetch index_page_limit_hit', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `endpoint=${shortUrlForLog(candidateEndpoint)} pages=${products.pagesFetched}` +
          ` next=${products.nextUrl || 'none'} discovered=${products.productIds.length}`,
      })
    }
    for (const payload of products.rawPayloads) {
      await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        jobKind: 'daily_home_index_fetch',
        collectionDate: job.collectionDate,
        notes: `daily_product_index lender=${job.lenderCode}`,
      })
    }
    const endpointElapsedMs = elapsedMs(endpointStartedAt)
    const endpointSummary = {
      endpoint: candidateEndpoint,
      index_payloads: products.rawPayloads.length,
      index_statuses: indexStatusSummary,
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
    const productIds = Array.from(discoveredProductIds)
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      bankName,
      collectionDate: job.collectionDate,
      expectedDetailCount: productIds.length,
    })
    const detailEnqueue =
      productIds.length > 0
        ? await enqueueProductDetailJobs(env, {
            runId: job.runId,
            runSource: job.runSource,
            lenderCode: job.lenderCode,
            dataset: 'home_loans',
            collectionDate: job.collectionDate,
            productIds,
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
        ` finalizer_jobs=${finalizerEnqueue.enqueued}` +
        ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
        ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},total=${elapsedMs(jobStartedAt)}`,
    })
    return
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
          productIdsDiscovered: 0,
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
      notes: noMortgageSignals ? `daily_no_data lender=${job.lenderCode}` : `daily_quality_rejected lender=${job.lenderCode}`,
    })
    if (noMortgageSignals) {
      log.info('consumer', `daily_lender_fetch completed: 0 written, no mortgage signals`, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `collected=0 inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
          ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
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
  log.info('consumer', `daily_lender_fetch completed: ${written} written, ${dropped.length} dropped`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length} written=${written}` +
      ` reasons=${JSON.stringify(droppedReasons)}` +
      ` inspected_html=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
      ` endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
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
      collection: {
        endpointsTried,
        indexPayloads,
        productIdsDiscovered: 0,
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
}
