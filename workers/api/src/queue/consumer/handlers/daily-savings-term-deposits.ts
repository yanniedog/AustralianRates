import { TARGET_LENDERS } from '../../../constants'
import { addRunEnqueuedCounts } from '../../../db/run-progress'
import {
  ensureLenderDatasetRun,
  markLenderDatasetIndexFetchSucceeded,
  setLenderDatasetExpectedDetails,
} from '../../../db/lender-dataset-runs'
import { getActiveCdrProductRefs } from '../../../db/active-cdr-products'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { persistRawPayload } from '../../../db/raw-payloads'
import { discoverProductsEndpoint } from '../../../ingest/cdr'
import { fetchSavingsProductIds, fetchTermDepositProductIds } from '../../../ingest/cdr-savings'
import { candidateProductEndpoints } from '../../../ingest/product-endpoints'
import { getLenderPlaybook } from '../../../ingest/lender-playbooks'
import { enqueueLenderFinalizeJobs, enqueueProductDetailJobs } from '../../producer'
import type { DailySavingsLenderJob, EnvBindings } from '../../../types'
import { log } from '../../../utils/logger'
import { detectUpstreamBlock } from '../../../utils/upstream-block'
import { nowIso } from '../../../utils/time'
import type { DatasetKind } from '../../../../../../packages/shared/src'
import { finalizeLenderDatasetIfReady } from '../finalization'
import { elapsedMs, serializeForLog, shortUrlForLog, summarizeEndpointHosts, summarizeProductSample, summarizeStatusCodes } from '../log-helpers'
import { maxCdrProductPages } from '../retry-config'
import { bankNameForLender, markProductsSeenForRun } from '../series-tracking'
import { shouldSoftFailNoSignals } from '../soft-fail-no-signals'
import { handleDailyUbankSavingsFallback } from './ubank-fallback'

export async function handleDailySavingsLenderJob(env: EnvBindings, job: DailySavingsLenderJob): Promise<void> {
  const startedAt = Date.now()
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) throw new Error(`unknown_lender_code:${job.lenderCode}`)
  const selectedDatasets = new Set<DatasetKind>(job.datasets?.length ? job.datasets : ['savings', 'term_deposits'])
  const shouldFetchSavings = selectedDatasets.has('savings')
  const shouldFetchTd = selectedDatasets.has('term_deposits')
  log.info('consumer', `daily_savings_lender_fetch started`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} run_source=${job.runSource ?? 'scheduled'}` +
      ` attempt=${job.attempt} idempotency=${job.idempotencyKey}`,
  })

  const playbook = getLenderPlaybook(lender)
  const bankName = bankNameForLender(lender)
  const ensureRuns: Promise<void>[] = []
  if (shouldFetchSavings) {
    ensureRuns.push(
      ensureLenderDatasetRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        bankName,
        collectionDate: job.collectionDate,
      }),
    )
  }
  if (shouldFetchTd) {
    ensureRuns.push(
      ensureLenderDatasetRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        bankName,
        collectionDate: job.collectionDate,
      }),
    )
  }
  await Promise.all(ensureRuns)
  if (lender.code === 'ubank') {
    await handleDailyUbankSavingsFallback(env, job, lender, selectedDatasets)
    return
  }
  const endpointDiscoveryStartedAt = Date.now()
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
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

  let endpointsTried = 0
  let indexPayloads = 0
  let savingsDetailJobsEnqueued = 0
  let tdDetailJobsEnqueued = 0
  let savingsCatalogSupplements = 0
  let tdCatalogSupplements = 0
  const savingsProductEndpointMap = new Map<string, string>()
  const tdProductEndpointMap = new Map<string, string>()
  const savingsFallbackFetchEventIdByProductId = new Map<string, number>()
  const tdFallbackFetchEventIdByProductId = new Map<string, number>()
  let savingsIndexSucceeded = false
  let tdIndexSucceeded = false
  const observedUpstreamStatuses: number[] = []
  const observedUpstreamBlocks: Array<{ sourceUrl: string; status: number; reasonCode: string; fetchEventId: number | null }> = []
  const endpointDiagnostics: Array<Record<string, unknown>> = []
  let collectionMs = 0

  log.info('consumer', 'daily_savings_lender_fetch collect', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `date=${job.collectionDate} endpoints=${uniqueCandidates.length}` +
      ` endpoint_hosts=${endpointHosts || 'none'}` +
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
      shouldFetchSavings
        ? fetchSavingsProductIds(candidateEndpoint, maxCdrProductPages(), {
            cdrVersions: playbook.cdrVersions,
            env,
            runId: job.runId,
            lenderCode: job.lenderCode,
          })
        : Promise.resolve({
            productIds: [] as string[],
            rawPayloads: [] as Array<{ sourceUrl: string; status: number; body: string }>,
            pageLimitHit: false,
            pagesFetched: 0,
            nextUrl: null as string | null,
          }),
      shouldFetchTd
        ? fetchTermDepositProductIds(candidateEndpoint, maxCdrProductPages(), {
            cdrVersions: playbook.cdrVersions,
            env,
            runId: job.runId,
            lenderCode: job.lenderCode,
          })
        : Promise.resolve({
            productIds: [] as string[],
            rawPayloads: [] as Array<{ sourceUrl: string; status: number; body: string }>,
            pageLimitHit: false,
            pagesFetched: 0,
            nextUrl: null as string | null,
          }),
    ])
    for (const payload of savingsProducts.rawPayloads) {
      observedUpstreamStatuses.push(payload.status)
    }
    for (const payload of tdProducts.rawPayloads) {
      observedUpstreamStatuses.push(payload.status)
    }
    indexPayloads += savingsProducts.rawPayloads.length + tdProducts.rawPayloads.length
    const uniqueSavingsIds = Array.from(new Set(savingsProducts.productIds)).filter(Boolean)
    const uniqueTdIds = Array.from(new Set(tdProducts.productIds)).filter(Boolean)
    const savingsIndexStatuses = summarizeStatusCodes(savingsProducts.rawPayloads.map((payload) => payload.status))
    const tdIndexStatuses = summarizeStatusCodes(tdProducts.rawPayloads.map((payload) => payload.status))
    const savingsIndexFetchSucceeded =
      savingsProducts.rawPayloads.length > 0 &&
      savingsProducts.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    const tdIndexFetchSucceeded =
      tdProducts.rawPayloads.length > 0 && tdProducts.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (savingsProducts.pageLimitHit) {
      log.error('consumer', 'daily_savings_lender_fetch savings_index_page_limit_hit', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `endpoint=${shortUrlForLog(candidateEndpoint)} pages=${savingsProducts.pagesFetched}` +
          ` next=${savingsProducts.nextUrl || 'none'} discovered=${savingsProducts.productIds.length}`,
      })
    }
    if (tdProducts.pageLimitHit) {
      log.error('consumer', 'daily_savings_lender_fetch td_index_page_limit_hit', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `endpoint=${shortUrlForLog(candidateEndpoint)} pages=${tdProducts.pagesFetched}` +
          ` next=${tdProducts.nextUrl || 'none'} discovered=${tdProducts.productIds.length}`,
      })
    }

    let savingsEndpointFallbackFetchEventId: number | null = null
    let tdEndpointFallbackFetchEventId: number | null = null
    for (const payload of savingsProducts.rawPayloads) {
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
        dataset: 'savings',
        jobKind: 'daily_deposit_index_fetch',
        collectionDate: job.collectionDate,
        notes:
          `savings_product_index lender=${job.lenderCode}` +
          (upstreamBlock.reasonCode ? ` reason=${upstreamBlock.reasonCode}` : ''),
      })
      if (savingsEndpointFallbackFetchEventId == null && persisted.fetchEventId != null) {
        savingsEndpointFallbackFetchEventId = persisted.fetchEventId
      }
      if (upstreamBlock.reasonCode) {
        observedUpstreamBlocks.push({
          sourceUrl: payload.sourceUrl,
          status: payload.status,
          reasonCode: upstreamBlock.reasonCode,
          fetchEventId: persisted.fetchEventId ?? null,
        })
        log.warn('consumer', 'daily_savings_lender_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `dataset=savings endpoint=${shortUrlForLog(candidateEndpoint)}` +
            ` source=${shortUrlForLog(payload.sourceUrl)} status=${payload.status}` +
            ` reason=${upstreamBlock.reasonCode} marker=${upstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${persisted.fetchEventId ?? 'none'}`,
        })
      }
    }
    for (const payload of tdProducts.rawPayloads) {
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
        dataset: 'term_deposits',
        jobKind: 'daily_deposit_index_fetch',
        collectionDate: job.collectionDate,
        notes:
          `term_deposit_product_index lender=${job.lenderCode}` +
          (upstreamBlock.reasonCode ? ` reason=${upstreamBlock.reasonCode}` : ''),
      })
      if (tdEndpointFallbackFetchEventId == null && persisted.fetchEventId != null) {
        tdEndpointFallbackFetchEventId = persisted.fetchEventId
      }
      if (upstreamBlock.reasonCode) {
        observedUpstreamBlocks.push({
          sourceUrl: payload.sourceUrl,
          status: payload.status,
          reasonCode: upstreamBlock.reasonCode,
          fetchEventId: persisted.fetchEventId ?? null,
        })
        log.warn('consumer', 'daily_savings_lender_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `dataset=term_deposits endpoint=${shortUrlForLog(candidateEndpoint)}` +
            ` source=${shortUrlForLog(payload.sourceUrl)} status=${payload.status}` +
            ` reason=${upstreamBlock.reasonCode} marker=${upstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${persisted.fetchEventId ?? 'none'}`,
        })
      }
    }

    if (shouldFetchSavings && savingsIndexFetchSucceeded) {
      savingsIndexSucceeded = true
      for (const productId of uniqueSavingsIds) {
        savingsProductEndpointMap.set(productId, candidateEndpoint)
        if (savingsEndpointFallbackFetchEventId != null) {
          savingsFallbackFetchEventIdByProductId.set(productId, savingsEndpointFallbackFetchEventId)
        }
      }
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        bankName,
        collectionDate: job.collectionDate,
        productIds: uniqueSavingsIds,
      })
    }
    if (shouldFetchTd && tdIndexFetchSucceeded) {
      tdIndexSucceeded = true
      for (const productId of uniqueTdIds) {
        tdProductEndpointMap.set(productId, candidateEndpoint)
        if (tdEndpointFallbackFetchEventId != null) {
          tdFallbackFetchEventIdByProductId.set(productId, tdEndpointFallbackFetchEventId)
        }
      }
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        bankName,
        collectionDate: job.collectionDate,
        productIds: uniqueTdIds,
      })
    }

    const endpointSummary = {
      endpoint: candidateEndpoint,
      savings_index_payloads: savingsProducts.rawPayloads.length,
      td_index_payloads: tdProducts.rawPayloads.length,
      savings_index_statuses: savingsIndexStatuses,
      td_index_statuses: tdIndexStatuses,
      upstream_blocks: observedUpstreamBlocks.filter((item) => item.sourceUrl.startsWith(candidateEndpoint)).length,
      savings_ids_discovered: uniqueSavingsIds.length,
      td_ids_discovered: uniqueTdIds.length,
      savings_ids_sample: summarizeProductSample(uniqueSavingsIds),
      td_ids_sample: summarizeProductSample(uniqueTdIds),
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
        ` upstream_blocks=${endpointSummary.upstream_blocks}` +
        ` product_ids(s=${uniqueSavingsIds.length},td=${uniqueTdIds.length})` +
        ` elapsed_ms=${endpointSummary.elapsed_ms}`,
    })

  }
  collectionMs = elapsedMs(collectStartedAt)

  if (shouldFetchSavings && savingsIndexSucceeded) {
    const refs = await getActiveCdrProductRefs(env.DB, { dataset: 'savings', bankName })
    for (const ref of refs) {
      if (savingsProductEndpointMap.has(ref.productId)) continue
      savingsProductEndpointMap.set(ref.productId, ref.endpointUrl)
      savingsCatalogSupplements += 1
    }
  }
  if (shouldFetchTd && tdIndexSucceeded) {
    const refs = await getActiveCdrProductRefs(env.DB, { dataset: 'term_deposits', bankName })
    for (const ref of refs) {
      if (tdProductEndpointMap.has(ref.productId)) continue
      tdProductEndpointMap.set(ref.productId, ref.endpointUrl)
      tdCatalogSupplements += 1
    }
  }

  const uniqueSavingsProductIds = Array.from(savingsProductEndpointMap.keys())
  const uniqueTdProductIds = Array.from(tdProductEndpointMap.keys())
  const savingsEndpointUrlByProductId = Object.fromEntries(
    Array.from(savingsProductEndpointMap.entries()).map(([productId, endpointUrl]) => [productId, endpointUrl]),
  )
  const tdEndpointUrlByProductId = Object.fromEntries(
    Array.from(tdProductEndpointMap.entries()).map(([productId, endpointUrl]) => [productId, endpointUrl]),
  )
  const savingsFallbackFetchEventMap = Object.fromEntries(
    Array.from(savingsFallbackFetchEventIdByProductId.entries()).map(([productId, fetchEventId]) => [productId, fetchEventId]),
  )
  const tdFallbackFetchEventMap = Object.fromEntries(
    Array.from(tdFallbackFetchEventIdByProductId.entries()).map(([productId, fetchEventId]) => [productId, fetchEventId]),
  )

  if (shouldFetchSavings && savingsIndexSucceeded) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
      bankName,
      collectionDate: job.collectionDate,
      expectedDetailCount: uniqueSavingsProductIds.length,
    })
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
    })
  }
  if (shouldFetchTd && tdIndexSucceeded) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
      bankName,
      collectionDate: job.collectionDate,
      expectedDetailCount: uniqueTdProductIds.length,
    })
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
    })
  }

  const savingsDetailEnqueue =
    shouldFetchSavings && savingsIndexSucceeded && uniqueSavingsProductIds.length > 0
      ? await enqueueProductDetailJobs(env, {
          runId: job.runId,
          runSource: job.runSource,
          lenderCode: job.lenderCode,
          dataset: 'savings',
          collectionDate: job.collectionDate,
          productIds: uniqueSavingsProductIds,
          endpointUrlByProductId: savingsEndpointUrlByProductId,
          fallbackFetchEventIdByProductId: savingsFallbackFetchEventMap,
        })
      : { enqueued: 0 }
  const tdDetailEnqueue =
    shouldFetchTd && tdIndexSucceeded && uniqueTdProductIds.length > 0
      ? await enqueueProductDetailJobs(env, {
          runId: job.runId,
          runSource: job.runSource,
          lenderCode: job.lenderCode,
          dataset: 'term_deposits',
          collectionDate: job.collectionDate,
          productIds: uniqueTdProductIds,
          endpointUrlByProductId: tdEndpointUrlByProductId,
          fallbackFetchEventIdByProductId: tdFallbackFetchEventMap,
        })
      : { enqueued: 0 }
  const finalizeDatasets: DatasetKind[] = []
  if (shouldFetchSavings && savingsIndexSucceeded) finalizeDatasets.push('savings')
  if (shouldFetchTd && tdIndexSucceeded) finalizeDatasets.push('term_deposits')
  const softFailNoSignals = shouldSoftFailNoSignals({
    lenderCode: job.lenderCode,
    successfulIndexFetch: finalizeDatasets.length > 0,
    observedUpstreamStatuses,
  })
  const finalizerEnqueue =
    finalizeDatasets.length > 0
      ? await enqueueLenderFinalizeJobs(env, {
          runId: job.runId,
          runSource: job.runSource,
          lenderCode: job.lenderCode,
          collectionDate: job.collectionDate,
          datasets: finalizeDatasets,
        })
      : { enqueued: 0 }

  savingsDetailJobsEnqueued = savingsDetailEnqueue.enqueued
  tdDetailJobsEnqueued = tdDetailEnqueue.enqueued
  const totalAdditionalJobs =
    savingsDetailEnqueue.enqueued + tdDetailEnqueue.enqueued + finalizerEnqueue.enqueued
  if (totalAdditionalJobs > 0) {
    await addRunEnqueuedCounts(env.DB, job.runId, {
      [job.lenderCode]: totalAdditionalJobs,
    })
  }

  const summaryDatasets: Array<DatasetKind | null> = finalizeDatasets.length > 0 ? [...finalizeDatasets] : [null]
  for (const summaryDataset of summaryDatasets) {
    await persistRawPayload(env, {
      sourceType: 'cdr_products',
      sourceUrl: `summary://${job.lenderCode}/savings-td/${summaryDataset ?? 'combined'}`,
      payload: {
        lenderCode: job.lenderCode,
        runId: job.runId,
        collectionDate: job.collectionDate,
        fetchedAt: nowIso(),
        summary_dataset: summaryDataset,
        savings: {
          discovered: uniqueSavingsProductIds.length,
          detail_jobs_enqueued: savingsDetailJobsEnqueued,
          index_succeeded: savingsIndexSucceeded,
        },
        term_deposits: {
          discovered: uniqueTdProductIds.length,
          detail_jobs_enqueued: tdDetailJobsEnqueued,
          index_succeeded: tdIndexSucceeded,
        },
        collection: {
          endpointsTried,
          indexPayloads,
          catalogSupplements: {
            savings: savingsCatalogSupplements,
            term_deposits: tdCatalogSupplements,
          },
        },
        observedUpstreamStatuses,
        softFailNoSignals,
        upstreamBlocks: {
          count: observedUpstreamBlocks.length,
          fetchEventIds: observedUpstreamBlocks.map((item) => item.fetchEventId).filter((id) => id != null),
          reasons: Array.from(new Set(observedUpstreamBlocks.map((item) => item.reasonCode))),
        },
        endpointDiagnostics,
        timing: {
          endpointDiscoveryMs,
          collectionMs,
          totalMs: elapsedMs(startedAt),
        },
        source_mix: {
          [job.runSource ?? 'scheduled']: totalAdditionalJobs,
        },
      },
      httpStatus: finalizeDatasets.length > 0 ? 202 : 204,
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: summaryDataset,
      jobKind: 'daily_deposit_index_fetch',
      collectionDate: job.collectionDate,
      notes: `savings_td_index_summary lender=${job.lenderCode} dataset=${summaryDataset ?? 'combined'}`,
    })
  }

  if (finalizeDatasets.length === 0) {
    if (softFailNoSignals) {
      for (const dataset of selectedDatasets) {
        await finalizeLenderDatasetIfReady(env, {
          runId: job.runId,
          lenderCode: job.lenderCode,
          dataset,
        })
      }
      log.info('consumer', 'daily_savings_lender_fetch completed: 0 written, no deposit signals', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `date=${job.collectionDate} endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
          ` selected_datasets=${serializeForLog(Array.from(selectedDatasets))}` +
          ` statuses=${serializeForLog(observedUpstreamStatuses)}` +
          ` upstream_blocks=${serializeForLog(observedUpstreamBlocks)}` +
          ` endpoint_diagnostics=${serializeForLog(endpointDiagnostics)}` +
          ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},total=${elapsedMs(startedAt)}`,
      })
      return
    }
    log.warn('consumer', 'daily_savings_lender_fetch empty_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
        ` upstream_blocks=${serializeForLog(observedUpstreamBlocks)}` +
        ` endpoint_diagnostics=${serializeForLog(endpointDiagnostics)}` +
        ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},total=${elapsedMs(startedAt)}`,
    })
    return
  }

  log.info('consumer', 'daily_savings_lender_fetch enqueued_detail_jobs', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `products(s=${uniqueSavingsProductIds.length},td=${uniqueTdProductIds.length})` +
      ` detail_jobs(s=${savingsDetailJobsEnqueued},td=${tdDetailJobsEnqueued})` +
      ` catalog_supplements(s=${savingsCatalogSupplements},td=${tdCatalogSupplements})` +
      ` finalizer_jobs=${finalizerEnqueue.enqueued}` +
      ` upstream_blocks=${observedUpstreamBlocks.length}` +
      ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},total=${elapsedMs(startedAt)}`,
  })
}
