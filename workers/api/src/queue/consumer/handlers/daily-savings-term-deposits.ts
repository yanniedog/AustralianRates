import { TARGET_LENDERS } from '../../../constants'
import { addRunEnqueuedCounts } from '../../../db/run-progress'
import { ensureLenderDatasetRun, setLenderDatasetExpectedDetails } from '../../../db/lender-dataset-runs'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { persistRawPayload } from '../../../db/raw-payloads'
import { discoverProductsEndpoint } from '../../../ingest/cdr'
import { fetchSavingsProductIds, fetchTermDepositProductIds } from '../../../ingest/cdr-savings'
import { getLenderPlaybook } from '../../../ingest/lender-playbooks'
import { enqueueLenderFinalizeJobs, enqueueProductDetailJobs } from '../../producer'
import type { DailySavingsLenderJob, EnvBindings } from '../../../types'
import { log } from '../../../utils/logger'
import { nowIso } from '../../../utils/time'
import type { DatasetKind } from '../../../../../../packages/shared/src'
import { elapsedMs, serializeForLog, shortUrlForLog, summarizeEndpointHosts, summarizeProductSample, summarizeStatusCodes } from '../log-helpers'
import { maxCdrProductPages } from '../retry-config'
import { bankNameForLender, markProductsSeenForRun } from '../series-tracking'

export async function handleDailySavingsLenderJob(env: EnvBindings, job: DailySavingsLenderJob): Promise<void> {
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
  const bankName = bankNameForLender(lender)
  await Promise.all([
    ensureLenderDatasetRun(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
      bankName,
      collectionDate: job.collectionDate,
    }),
    ensureLenderDatasetRun(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
      bankName,
      collectionDate: job.collectionDate,
    }),
  ])
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

  let endpointsTried = 0
  let indexPayloads = 0
  let savingsDetailJobsEnqueued = 0
  let tdDetailJobsEnqueued = 0
  const savingsProductIds = new Set<string>()
  const tdProductIds = new Set<string>()
  let savingsIndexSucceeded = false
  let tdIndexSucceeded = false
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
      fetchSavingsProductIds(candidateEndpoint, maxCdrProductPages(), { cdrVersions: playbook.cdrVersions }),
      fetchTermDepositProductIds(candidateEndpoint, maxCdrProductPages(), { cdrVersions: playbook.cdrVersions }),
    ])
    indexPayloads += savingsProducts.rawPayloads.length + tdProducts.rawPayloads.length
    const uniqueSavingsIds = Array.from(new Set(savingsProducts.productIds)).filter(Boolean)
    const uniqueTdIds = Array.from(new Set(tdProducts.productIds)).filter(Boolean)
    const savingsIndexStatuses = summarizeStatusCodes(savingsProducts.rawPayloads.map((payload) => payload.status))
    const tdIndexStatuses = summarizeStatusCodes(tdProducts.rawPayloads.map((payload) => payload.status))
    const savingsIndexFetchSucceeded =
      savingsProducts.rawPayloads.length > 0 &&
      savingsProducts.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (savingsIndexFetchSucceeded) {
      savingsIndexSucceeded = true
      for (const productId of uniqueSavingsIds) savingsProductIds.add(productId)
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        bankName,
        collectionDate: job.collectionDate,
        productIds: uniqueSavingsIds,
      })
    }
    const tdIndexFetchSucceeded =
      tdProducts.rawPayloads.length > 0 && tdProducts.rawPayloads.every((payload) => payload.status >= 200 && payload.status < 400)
    if (tdIndexFetchSucceeded) {
      tdIndexSucceeded = true
      for (const productId of uniqueTdIds) tdProductIds.add(productId)
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        bankName,
        collectionDate: job.collectionDate,
        productIds: uniqueTdIds,
      })
    }
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

    for (const payload of [...savingsProducts.rawPayloads, ...tdProducts.rawPayloads]) {
      await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: uniqueSavingsIds.length > 0 ? 'savings' : 'term_deposits',
        jobKind: 'daily_deposit_index_fetch',
        collectionDate: job.collectionDate,
        notes: `savings_td_product_index lender=${job.lenderCode}`,
      })
    }

    const endpointSummary = {
      endpoint: candidateEndpoint,
      savings_index_payloads: savingsProducts.rawPayloads.length,
      td_index_payloads: tdProducts.rawPayloads.length,
      savings_index_statuses: savingsIndexStatuses,
      td_index_statuses: tdIndexStatuses,
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
        ` product_ids(s=${uniqueSavingsIds.length},td=${uniqueTdIds.length})` +
        ` elapsed_ms=${endpointSummary.elapsed_ms}`,
    })

  }
  collectionMs = elapsedMs(collectStartedAt)

  const uniqueSavingsProductIds = Array.from(savingsProductIds)
  const uniqueTdProductIds = Array.from(tdProductIds)

  if (savingsIndexSucceeded) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
      bankName,
      collectionDate: job.collectionDate,
      expectedDetailCount: uniqueSavingsProductIds.length,
    })
  }
  if (tdIndexSucceeded) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
      bankName,
      collectionDate: job.collectionDate,
      expectedDetailCount: uniqueTdProductIds.length,
    })
  }

  const savingsDetailEnqueue =
    savingsIndexSucceeded && uniqueSavingsProductIds.length > 0
      ? await enqueueProductDetailJobs(env, {
          runId: job.runId,
          runSource: job.runSource,
          lenderCode: job.lenderCode,
          dataset: 'savings',
          collectionDate: job.collectionDate,
          productIds: uniqueSavingsProductIds,
        })
      : { enqueued: 0 }
  const tdDetailEnqueue =
    tdIndexSucceeded && uniqueTdProductIds.length > 0
      ? await enqueueProductDetailJobs(env, {
          runId: job.runId,
          runSource: job.runSource,
          lenderCode: job.lenderCode,
          dataset: 'term_deposits',
          collectionDate: job.collectionDate,
          productIds: uniqueTdProductIds,
        })
      : { enqueued: 0 }
  const finalizeDatasets: DatasetKind[] = []
  if (savingsIndexSucceeded) finalizeDatasets.push('savings')
  if (tdIndexSucceeded) finalizeDatasets.push('term_deposits')
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

  await persistRawPayload(env, {
    sourceType: 'cdr_products',
    sourceUrl: `summary://${job.lenderCode}/savings-td`,
    payload: {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
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
    dataset: savingsIndexSucceeded ? 'savings' : 'term_deposits',
    jobKind: 'daily_deposit_index_fetch',
    collectionDate: job.collectionDate,
    notes: `savings_td_index_summary lender=${job.lenderCode}`,
  })

  if (finalizeDatasets.length === 0) {
    log.warn('consumer', 'daily_savings_lender_fetch empty_result', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `date=${job.collectionDate} endpoints_tried=${endpointsTried} index_payloads=${indexPayloads}` +
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
      ` finalizer_jobs=${finalizerEnqueue.enqueued}` +
      ` timings(ms):discover=${endpointDiscoveryMs},collect=${collectionMs},total=${elapsedMs(startedAt)}`,
  })
}
