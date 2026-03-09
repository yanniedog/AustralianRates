import { TARGET_LENDERS } from '../../../constants'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { ensureLenderDatasetRun, recordLenderDatasetWriteStats } from '../../../db/lender-dataset-runs'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { upsertSavingsRateRows } from '../../../db/savings-rates'
import { upsertTdRateRows } from '../../../db/td-rates'
import { fetchProductDetailRows } from '../../../ingest/cdr'
import { fetchSavingsProductDetailRows, fetchTdProductDetailRows } from '../../../ingest/cdr-savings'
import { getLenderPlaybook } from '../../../ingest/lender-playbooks'
import type { EnvBindings, ProductDetailJob } from '../../../types'
import { log } from '../../../utils/logger'
import { detectUpstreamBlock } from '../../../utils/upstream-block'
import { recordDroppedAnomalies } from '../anomalies'
import { ensureProductDetailFetchEventId } from '../detail-fetch-event'
import { markDetailProcessedAndFinalize } from '../finalization'
import { elapsedMs, serializeForLog } from '../log-helpers'
import { bankNameForLender, markHomeLoanSeriesSeenForRun, markProductsSeenForRun, markSavingsSeriesSeenForRun, markTdSeriesSeenForRun } from '../series-tracking'
import { splitValidatedRows, splitValidatedSavingsRows, splitValidatedTdRows } from '../validation'

export function resolveProductDetailEndpoint(
  job: Pick<ProductDetailJob, 'endpointUrl'>,
  cachedEndpoint: { endpointUrl: string } | null,
): { endpointUrl: string; endpointSource: 'job_override' | 'cache' | 'none' } {
  const endpointUrl = job.endpointUrl || cachedEndpoint?.endpointUrl || ''
  if (job.endpointUrl) return { endpointUrl, endpointSource: 'job_override' }
  if (cachedEndpoint) return { endpointUrl, endpointSource: 'cache' }
  return { endpointUrl, endpointSource: 'none' }
}

export function resolveRowFetchEventId(input: {
  detailFetchEventId?: number | null
  fallbackFetchEventId?: number | null
  rowFetchEventId?: number | null
}): number | null {
  if (input.detailFetchEventId != null) return input.detailFetchEventId
  if (input.fallbackFetchEventId != null) return input.fallbackFetchEventId
  if (input.rowFetchEventId != null) return input.rowFetchEventId
  return null
}

function countRowsMissingFetchEventId(rows: Array<{ fetchEventId?: number | null }>): number {
  return rows.reduce((sum, row) => sum + (row.fetchEventId == null ? 1 : 0), 0)
}

export async function handleProductDetailJob(env: EnvBindings, job: ProductDetailJob): Promise<void> {
  const startedAt = Date.now()
  const cachedEndpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  const { endpointUrl, endpointSource } = resolveProductDetailEndpoint(job, cachedEndpoint)
  if (!endpointUrl || !lender) {
    await markDetailProcessedAndFinalize(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: job.dataset,
      failed: true,
      errorMessage: 'missing_endpoint_or_lender',
    })
    log.warn('consumer', `product_detail_fetch skipped: missing endpoint or lender`, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `dataset=${job.dataset} product=${job.productId} date=${job.collectionDate}` +
        ` has_endpoint=${endpointUrl ? 1 : 0} has_lender=${lender ? 1 : 0}`,
    })
    throw new Error(`product_detail_missing_context:${job.lenderCode}:${job.dataset}:${job.productId}`)
  }
  const bankName = bankNameForLender(lender)
  await ensureLenderDatasetRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: job.dataset,
    bankName,
    collectionDate: job.collectionDate,
  })
  log.info('consumer', `product_detail_fetch started for ${job.productId}`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `dataset=${job.dataset} date=${job.collectionDate} endpoint=${endpointUrl}` +
      ` endpoint_source=${endpointSource}` +
      ` run_source=${job.runSource ?? 'scheduled'} attempt=${job.attempt}`,
  })

  try {
    const fetchStartedAt = Date.now()
    const versions = getLenderPlaybook(lender).cdrVersions

    let fetchedRows = 0
    let acceptedRows = 0
    let written = 0
    let validationMs = 0
    let fetchStatus = 0
    let fetchEventId: number | null | undefined
    const fallbackFetchEventId = job.fallbackFetchEventId ?? null
    let droppedReasons: Record<string, number> = {}

    if (job.dataset === 'home_loans') {
      const details = await fetchProductDetailRows({
        lender,
        endpointUrl,
        productId: job.productId,
        collectionDate: job.collectionDate,
        cdrVersions: versions,
        env,
        runId: job.runId,
        lenderCode: job.lenderCode,
      })
      fetchStatus = details.rawPayload.status
      const persisted = await ensureProductDetailFetchEventId(env, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        jobKind: 'product_detail_fetch',
        collectionDate: job.collectionDate,
        durationMs: elapsedMs(fetchStartedAt),
        productId: job.productId,
        notes: `direct_product_detail lender=${job.lenderCode} product=${job.productId}`,
      })
      fetchEventId = persisted.fetchEventId
      const upstreamBlock = detectUpstreamBlock({
        status: details.rawPayload.status,
        body: details.rawPayload.body,
      })
      if (upstreamBlock.blocked) {
        log.warn('consumer', 'product_detail_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `dataset=${job.dataset} product=${job.productId} status=${details.rawPayload.status}` +
            ` reason=${upstreamBlock.reasonCode}` +
            ` marker=${upstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${fetchEventId ?? 'none'}`,
        })
      }
      for (const row of details.rows) {
        row.fetchEventId = resolveRowFetchEventId({
          detailFetchEventId: fetchEventId ?? null,
          fallbackFetchEventId,
          rowFetchEventId: row.fetchEventId ?? null,
        })
      }
      fetchedRows = details.rows.length
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        bankName,
        collectionDate: job.collectionDate,
        productIds: details.rows.map((row) => row.productId),
      })
      await markHomeLoanSeriesSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        collectionDate: job.collectionDate,
        rows: details.rows,
      })
      const validationStartedAt = Date.now()
      const { accepted, dropped } = splitValidatedRows(details.rows)
      validationMs = elapsedMs(validationStartedAt)
      droppedReasons = {}
      for (const item of dropped) droppedReasons[item.reason] = (droppedReasons[item.reason] || 0) + 1
      await recordDroppedAnomalies(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        fetchEventId,
        dropped,
      })
      for (const row of accepted) {
        row.runId = job.runId
        row.runSource = job.runSource ?? 'scheduled'
      }
      acceptedRows = accepted.length
      const acceptedMissingLineage = countRowsMissingFetchEventId(accepted)
      if (acceptedMissingLineage > 0) {
        await recordLenderDatasetWriteStats(env.DB, {
          runId: job.runId,
          lenderCode: job.lenderCode,
          dataset: 'home_loans',
          acceptedRows,
          droppedRows: dropped.length,
          detailFetchEventCount: fetchEventId != null ? 1 : 0,
          lineageErrors: acceptedMissingLineage,
          errorMessage: `detail_lineage_missing_for_accepted_rows:${job.productId}`,
        })
        throw new Error(`detail_lineage_persist_failed:home_loans:${job.productId}`)
      }
      if (accepted.length > 0) {
        written = await upsertHistoricalRateRows(env.DB, accepted)
      }
      await recordLenderDatasetWriteStats(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
        acceptedRows,
        writtenRows: written,
        droppedRows: dropped.length,
        detailFetchEventCount: fetchEventId != null ? 1 : 0,
      })
    } else if (job.dataset === 'savings') {
      const details = await fetchSavingsProductDetailRows({
        lender,
        endpointUrl,
        productId: job.productId,
        collectionDate: job.collectionDate,
        cdrVersions: versions,
        env,
        runId: job.runId,
        lenderCode: job.lenderCode,
      })
      fetchStatus = details.rawPayload.status
      const persisted = await ensureProductDetailFetchEventId(env, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        jobKind: 'product_detail_fetch',
        collectionDate: job.collectionDate,
        durationMs: elapsedMs(fetchStartedAt),
        productId: job.productId,
        notes: `savings_product_detail lender=${job.lenderCode} product=${job.productId}`,
      })
      fetchEventId = persisted.fetchEventId
      const upstreamBlock = detectUpstreamBlock({
        status: details.rawPayload.status,
        body: details.rawPayload.body,
      })
      if (upstreamBlock.blocked) {
        log.warn('consumer', 'product_detail_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `dataset=${job.dataset} product=${job.productId} status=${details.rawPayload.status}` +
            ` reason=${upstreamBlock.reasonCode}` +
            ` marker=${upstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${fetchEventId ?? 'none'}`,
        })
      }
      for (const row of details.savingsRows) {
        row.fetchEventId = resolveRowFetchEventId({
          detailFetchEventId: fetchEventId ?? null,
          fallbackFetchEventId,
          rowFetchEventId: row.fetchEventId ?? null,
        })
      }
      fetchedRows = details.savingsRows.length
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        bankName,
        collectionDate: job.collectionDate,
        productIds: details.savingsRows.map((row) => row.productId),
      })
      await markSavingsSeriesSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        collectionDate: job.collectionDate,
        rows: details.savingsRows,
      })
      const validationStartedAt = Date.now()
      const { accepted, dropped } = splitValidatedSavingsRows(details.savingsRows)
      validationMs = elapsedMs(validationStartedAt)
      droppedReasons = {}
      for (const item of dropped) droppedReasons[item.reason] = (droppedReasons[item.reason] || 0) + 1
      await recordDroppedAnomalies(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        fetchEventId,
        dropped,
      })
      for (const row of accepted) {
        row.runId = job.runId
        row.runSource = job.runSource ?? 'scheduled'
      }
      acceptedRows = accepted.length
      const acceptedMissingLineage = countRowsMissingFetchEventId(accepted)
      if (acceptedMissingLineage > 0) {
        await recordLenderDatasetWriteStats(env.DB, {
          runId: job.runId,
          lenderCode: job.lenderCode,
          dataset: 'savings',
          acceptedRows,
          droppedRows: dropped.length,
          detailFetchEventCount: fetchEventId != null ? 1 : 0,
          lineageErrors: acceptedMissingLineage,
          errorMessage: `detail_lineage_missing_for_accepted_rows:${job.productId}`,
        })
        throw new Error(`detail_lineage_persist_failed:savings:${job.productId}`)
      }
      if (accepted.length > 0) {
        written = await upsertSavingsRateRows(env.DB, accepted)
      }
      await recordLenderDatasetWriteStats(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        acceptedRows,
        writtenRows: written,
        droppedRows: dropped.length,
        detailFetchEventCount: fetchEventId != null ? 1 : 0,
      })
    } else {
      const details = await fetchTdProductDetailRows({
        lender,
        endpointUrl,
        productId: job.productId,
        collectionDate: job.collectionDate,
        cdrVersions: versions,
        env,
        runId: job.runId,
        lenderCode: job.lenderCode,
      })
      fetchStatus = details.rawPayload.status
      const persisted = await ensureProductDetailFetchEventId(env, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        jobKind: 'product_detail_fetch',
        collectionDate: job.collectionDate,
        durationMs: elapsedMs(fetchStartedAt),
        productId: job.productId,
        notes: `td_product_detail lender=${job.lenderCode} product=${job.productId}`,
      })
      fetchEventId = persisted.fetchEventId
      const upstreamBlock = detectUpstreamBlock({
        status: details.rawPayload.status,
        body: details.rawPayload.body,
      })
      if (upstreamBlock.blocked) {
        log.warn('consumer', 'product_detail_fetch upstream_block_detected', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `dataset=${job.dataset} product=${job.productId} status=${details.rawPayload.status}` +
            ` reason=${upstreamBlock.reasonCode}` +
            ` marker=${upstreamBlock.marker || 'none'}` +
            ` fetch_event_id=${fetchEventId ?? 'none'}`,
        })
      }
      for (const row of details.tdRows) {
        row.fetchEventId = resolveRowFetchEventId({
          detailFetchEventId: fetchEventId ?? null,
          fallbackFetchEventId,
          rowFetchEventId: row.fetchEventId ?? null,
        })
      }
      fetchedRows = details.tdRows.length
      await markProductsSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        bankName,
        collectionDate: job.collectionDate,
        productIds: details.tdRows.map((row) => row.productId),
      })
      await markTdSeriesSeenForRun(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        collectionDate: job.collectionDate,
        rows: details.tdRows,
      })
      const validationStartedAt = Date.now()
      const { accepted, dropped } = splitValidatedTdRows(details.tdRows)
      validationMs = elapsedMs(validationStartedAt)
      droppedReasons = {}
      for (const item of dropped) droppedReasons[item.reason] = (droppedReasons[item.reason] || 0) + 1
      await recordDroppedAnomalies(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        fetchEventId,
        dropped,
      })
      for (const row of accepted) {
        row.runId = job.runId
        row.runSource = job.runSource ?? 'scheduled'
      }
      acceptedRows = accepted.length
      const acceptedMissingLineage = countRowsMissingFetchEventId(accepted)
      if (acceptedMissingLineage > 0) {
        await recordLenderDatasetWriteStats(env.DB, {
          runId: job.runId,
          lenderCode: job.lenderCode,
          dataset: 'term_deposits',
          acceptedRows,
          droppedRows: dropped.length,
          detailFetchEventCount: fetchEventId != null ? 1 : 0,
          lineageErrors: acceptedMissingLineage,
          errorMessage: `detail_lineage_missing_for_accepted_rows:${job.productId}`,
        })
        throw new Error(`detail_lineage_persist_failed:term_deposits:${job.productId}`)
      }
      if (accepted.length > 0) {
        written = await upsertTdRateRows(env.DB, accepted)
      }
      await recordLenderDatasetWriteStats(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'term_deposits',
        acceptedRows,
        writtenRows: written,
        droppedRows: dropped.length,
        detailFetchEventCount: fetchEventId != null ? 1 : 0,
      })
    }

    await markDetailProcessedAndFinalize(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: job.dataset,
    })

    log.info('consumer', 'product_detail_fetch completed', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `dataset=${job.dataset} product=${job.productId} status=${fetchStatus}` +
        ` lineage(detail=${fetchEventId ?? 'none'},fallback=${fallbackFetchEventId ?? 'none'})` +
        ` fetched=${fetchedRows} accepted=${acceptedRows} written=${written}` +
        ` dropped_reasons=${serializeForLog(droppedReasons)}` +
        ` timings(ms):validate=${validationMs},total=${elapsedMs(startedAt)}`,
    })
  } catch (error) {
    const errorMessage = (error as Error)?.message || String(error)
    await markDetailProcessedAndFinalize(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: job.dataset,
      failed: true,
      errorMessage,
    })
    throw error
  }
}
