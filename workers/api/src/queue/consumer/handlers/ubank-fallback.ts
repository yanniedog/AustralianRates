import { persistRawPayload } from '../../../db/raw-payloads'
import {
  markLenderDatasetDetailProcessed,
  markLenderDatasetIndexFetchSucceeded,
  recordLenderDatasetWriteStats,
  setLenderDatasetExpectedDetails,
} from '../../../db/lender-dataset-runs'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { upsertSavingsRateRows } from '../../../db/savings-rates'
import { extractLenderRatesFromHtml } from '../../../ingest/html-rate-parser'
import {
  parseUbankHomeLoanRatesFromHtml,
  parseUbankSavingsRows,
  UBANK_HOME_LOAN_FALLBACK_URLS,
  UBANK_PUBLIC_HTML_FETCH_HEADERS,
  UBANK_SAVINGS_FALLBACK_URLS,
} from '../../../ingest/ubank-fallback'
import type { DailyLenderJob, DailySavingsLenderJob, EnvBindings, LenderConfig } from '../../../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../../../utils/fetch-with-timeout'
import { log } from '../../../utils/logger'
import { nowIso } from '../../../utils/time'
import { detectUpstreamBlock } from '../../../utils/upstream-block'
import { recordDroppedAnomalies } from '../anomalies'
import { finalizeLenderDatasetIfReady } from '../finalization'
import { elapsedMs, serializeForLog, summarizeDropReasons } from '../log-helpers'
import { markHomeLoanSeriesSeenForRun, markProductsSeenForRun, markSavingsSeriesSeenForRun } from '../series-tracking'
import { splitValidatedRows, splitValidatedSavingsRows } from '../validation'
import type { DatasetKind } from '../../../../../../packages/shared/src'

type PageFetchResult = {
  url: string
  status: number
  body: string
  fetchEventId: number | null
  upstreamBlock: ReturnType<typeof detectUpstreamBlock>
}

async function fetchAndPersistPage(input: {
  env: EnvBindings
  url: string
  runId: string
  lenderCode: string
  dataset: DatasetKind
  collectionDate: string
  jobKind: 'daily_home_index_fetch' | 'daily_deposit_index_fetch'
}): Promise<PageFetchResult> {
  let response: Response
  let html = ''
  try {
    const fetched = await fetchWithTimeout(input.url, { headers: UBANK_PUBLIC_HTML_FETCH_HEADERS }, { env: input.env })
    response = fetched.response
    html = await response.text()
    log.info('consumer', 'upstream_fetch', {
      runId: input.runId,
      lenderCode: input.lenderCode,
      context:
        `source=ubank_fallback host=${hostFromUrl(input.url)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? response.status}`,
    })
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('consumer', 'upstream_fetch', {
      runId: input.runId,
      lenderCode: input.lenderCode,
      context:
        `source=ubank_fallback host=${hostFromUrl(input.url)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })
    throw error
  }

  const upstreamBlock = detectUpstreamBlock({
    status: response.status,
    body: html,
    headers: response.headers,
  })
  const persisted = await persistRawPayload(input.env, {
    sourceType: 'wayback_html',
    sourceUrl: input.url,
    payload: html,
    httpStatus: response.status,
    runId: input.runId,
    lenderCode: input.lenderCode,
    dataset: input.dataset,
    jobKind: input.jobKind,
    collectionDate: input.collectionDate,
    notes: `ubank_fallback lender=${input.lenderCode}` + (upstreamBlock.reasonCode ? ` reason=${upstreamBlock.reasonCode}` : ''),
  })
  return {
    url: input.url,
    status: response.status,
    body: html,
    fetchEventId: persisted.fetchEventId ?? null,
    upstreamBlock,
  }
}

export async function handleDailyUbankHomeLoanFallback(env: EnvBindings, job: DailyLenderJob, lender: LenderConfig): Promise<void> {
  const startedAt = Date.now()
  const collectedRows: Parameters<typeof splitValidatedRows>[0] = []
  const observedUpstreamStatuses: number[] = []
  const observedUpstreamBlocks: Array<{ sourceUrl: string; status: number; reasonCode: string; fetchEventId: number | null }> = []
  const pageDiagnostics: Array<Record<string, unknown>> = []
  let inspectedHtml = 0
  let droppedByParser = 0
  let successfulFallbackPageFetches = 0

  for (const pageUrl of UBANK_HOME_LOAN_FALLBACK_URLS) {
    const pageStartedAt = Date.now()
    const fetched = await fetchAndPersistPage({
      env,
      url: pageUrl,
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      collectionDate: job.collectionDate,
      jobKind: 'daily_home_index_fetch',
    })
    if (!fetched.upstreamBlock.reasonCode && fetched.status >= 200 && fetched.status < 400) {
      successfulFallbackPageFetches += 1
    }
    observedUpstreamStatuses.push(fetched.status)
    if (fetched.upstreamBlock.reasonCode) {
      observedUpstreamBlocks.push({
        sourceUrl: fetched.url,
        status: fetched.status,
        reasonCode: fetched.upstreamBlock.reasonCode,
        fetchEventId: fetched.fetchEventId,
      })
    }

    const structured = parseUbankHomeLoanRatesFromHtml({
      lender,
      html: fetched.body,
      sourceUrl: fetched.url,
      collectionDate: job.collectionDate,
      qualityFlag: 'scraped_fallback_strict',
    })
    const parsed =
      structured.rows.length > 0
        ? structured
        : extractLenderRatesFromHtml({
            lender,
            html: fetched.body,
            sourceUrl: fetched.url,
            collectionDate: job.collectionDate,
            mode: 'daily',
            qualityFlag: 'scraped_fallback_strict',
          })
    inspectedHtml += parsed.inspected
    droppedByParser += parsed.dropped
    for (const row of parsed.rows) {
      row.fetchEventId = fetched.fetchEventId
      collectedRows.push(row)
    }
    pageDiagnostics.push({
      url: fetched.url,
      status: fetched.status,
      fetch_event_id: fetched.fetchEventId,
      parsed_rows: parsed.rows.length,
      inspected: parsed.inspected,
      dropped: parsed.dropped,
      elapsed_ms: elapsedMs(pageStartedAt),
    })
  }
  const parsedProductIds = Array.from(new Set(collectedRows.map((row) => row.productId).filter(Boolean)))
  if (parsedProductIds.length > 0) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      bankName: lender.canonical_bank_name,
      collectionDate: job.collectionDate,
      expectedDetailCount: parsedProductIds.length,
    })
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
  } else if (successfulFallbackPageFetches > 0) {
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
    log.info('consumer', 'ubank_home_fallback_index_ok_without_product_ids', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `successful_pages=${successfulFallbackPageFetches}` +
        ` inspected=${inspectedHtml} dropped_by_parser=${droppedByParser}` +
        ` statuses=${serializeForLog(observedUpstreamStatuses)}`,
    })
  }

  await markProductsSeenForRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    bankName: lender.canonical_bank_name,
    collectionDate: job.collectionDate,
    productIds: parsedProductIds,
  })
  await markHomeLoanSeriesSeenForRun(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    collectionDate: job.collectionDate,
    rows: collectedRows,
  })

  const { accepted, dropped } = splitValidatedRows(collectedRows)
  const droppedReasons = summarizeDropReasons(dropped)
  await recordDroppedAnomalies(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    dropped,
  })
  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }

  const hadSignals = collectedRows.length > 0 || inspectedHtml > 0 || droppedByParser > 0
  if (accepted.length === 0) {
    await persistRawPayload(env, {
      sourceType: 'cdr_products',
      sourceUrl: 'summary://ubank/home-loans',
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
        observedUpstreamStatuses,
        upstreamBlocks: observedUpstreamBlocks,
        pageDiagnostics,
        timings: {
          totalMs: elapsedMs(startedAt),
        },
      },
      httpStatus: hadSignals ? 422 : 204,
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
      jobKind: 'daily_home_index_fetch',
      collectionDate: job.collectionDate,
      notes: `ubank_home_fallback lender=${job.lenderCode}`,
    })
    if (!hadSignals) {
      await finalizeLenderDatasetIfReady(env, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'home_loans',
      })
      return
    }
    log.warn('consumer', 'ubank_home_fallback_all_dropped', {
      code: 'ubank_home_fallback_no_valid_rows',
      runId: job.runId,
      lenderCode: job.lenderCode,
      context: `collected=${collectedRows.length} accepted=0 dropped=${dropped.length} dropped_reasons=${Object.keys(droppedReasons).join(',')} inspected=${inspectedHtml} dropped_by_parser=${droppedByParser}`,
    })
    await finalizeLenderDatasetIfReady(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
    return
  }

  const written = await upsertHistoricalRateRows(env.DB, accepted)
  await recordLenderDatasetWriteStats(env.DB, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    acceptedRows: accepted.length,
    writtenRows: written,
    droppedRows: dropped.length,
    detailFetchEventCount: parsedProductIds.length,
  })
  for (let i = 0; i < parsedProductIds.length; i += 1) {
    await markLenderDatasetDetailProcessed(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'home_loans',
    })
  }
  await persistRawPayload(env, {
    sourceType: 'cdr_products',
    sourceUrl: 'summary://ubank/home-loans',
    payload: {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      productRows: collectedRows.length,
      acceptedRows: accepted.length,
      rejectedRows: dropped.length,
      droppedReasons,
      inspectedHtml,
      droppedByParser,
      observedUpstreamStatuses,
      upstreamBlocks: observedUpstreamBlocks,
      pageDiagnostics,
      timings: {
        totalMs: elapsedMs(startedAt),
      },
    },
    httpStatus: 200,
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
    jobKind: 'daily_home_index_fetch',
    collectionDate: job.collectionDate,
    notes: `ubank_home_fallback lender=${job.lenderCode}`,
  })
  await finalizeLenderDatasetIfReady(env, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    dataset: 'home_loans',
  })
  log.info('consumer', 'daily_lender_fetch ubank_fallback_completed', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `accepted=${accepted.length} written=${written} dropped=${dropped.length}` +
      ` statuses=${serializeForLog(observedUpstreamStatuses)}` +
      ` pages=${pageDiagnostics.length} total_ms=${elapsedMs(startedAt)}`,
  })
}

export async function handleDailyUbankSavingsFallback(
  env: EnvBindings,
  job: DailySavingsLenderJob,
  lender: LenderConfig,
  selectedDatasets: Set<DatasetKind>,
): Promise<void> {
  const startedAt = Date.now()
  const pageUrls = [
    UBANK_SAVINGS_FALLBACK_URLS.saveOverview,
    UBANK_SAVINGS_FALLBACK_URLS.saveRateHelp,
    UBANK_SAVINGS_FALLBACK_URLS.bonusCriteriaHelp,
    UBANK_SAVINGS_FALLBACK_URLS.billsHelp,
  ]
  const pageResults = await Promise.all(
    pageUrls.map(async (url) => {
      try {
        return await fetchAndPersistPage({
          env,
          url,
          runId: job.runId,
          lenderCode: job.lenderCode,
          dataset: 'savings',
          collectionDate: job.collectionDate,
          jobKind: 'daily_deposit_index_fetch',
        })
      } catch (error) {
        log.warn('consumer', 'ubank_savings_fallback_page_fetch_failed', {
          runId: job.runId,
          lenderCode: job.lenderCode,
          context:
            `url=${serializeForLog(url)} err=${error instanceof Error ? error.message : String(error)}`,
        })
        return {
          url,
          status: 0,
          body: '',
          fetchEventId: null as number | null,
          upstreamBlock: detectUpstreamBlock({ status: 0, body: '' }),
        }
      }
    }),
  )
  const pageByUrl = Object.fromEntries(pageResults.map((page) => [page.url, page]))
  const observedUpstreamStatuses = pageResults.map((page) => page.status)
  const observedUpstreamBlocks = pageResults
    .filter((page) => page.upstreamBlock.reasonCode)
    .map((page) => ({
      sourceUrl: page.url,
      status: page.status,
      reasonCode: page.upstreamBlock.reasonCode || 'unknown',
      fetchEventId: page.fetchEventId,
    }))

  if (selectedDatasets.has('savings')) {
    const parsed = parseUbankSavingsRows({
      lender,
      saveOverviewHtml: pageByUrl[UBANK_SAVINGS_FALLBACK_URLS.saveOverview]?.body || '',
      saveRateHelpHtml: pageByUrl[UBANK_SAVINGS_FALLBACK_URLS.saveRateHelp]?.body || '',
      bonusCriteriaHtml: pageByUrl[UBANK_SAVINGS_FALLBACK_URLS.bonusCriteriaHelp]?.body || '',
      billsHelpHtml: pageByUrl[UBANK_SAVINGS_FALLBACK_URLS.billsHelp]?.body || '',
      collectionDate: job.collectionDate,
      qualityFlag: 'scraped_fallback_strict',
    })
    for (const row of parsed.rows) {
      row.fetchEventId = pageByUrl[row.sourceUrl]?.fetchEventId ?? null
    }
    const parsedProductIds = Array.from(new Set(parsed.rows.map((row) => row.productId).filter(Boolean)))
    if (parsed.rows.length === 0) {
      log.warn('consumer', 'ubank_savings_fallback_zero_parsed_rows', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `statuses=${serializeForLog(pageResults.map((p) => p.status))}` +
          ` body_lens=${serializeForLog(pageResults.map((p) => p.body.length))}`,
      })
    }
    if (parsedProductIds.length > 0) {
      await setLenderDatasetExpectedDetails(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        bankName: lender.canonical_bank_name,
        collectionDate: job.collectionDate,
        expectedDetailCount: parsedProductIds.length,
      })
      await markLenderDatasetIndexFetchSucceeded(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
      })
    }
    await markProductsSeenForRun(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
      bankName: lender.canonical_bank_name,
      collectionDate: job.collectionDate,
      productIds: parsedProductIds,
    })
    await markSavingsSeriesSeenForRun(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      collectionDate: job.collectionDate,
      rows: parsed.rows,
    })
    const { accepted, dropped } = splitValidatedSavingsRows(parsed.rows)
    const droppedReasons = summarizeDropReasons(dropped)
    await recordDroppedAnomalies(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
      dropped,
    })
    for (const row of accepted) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
    }
    if (accepted.length > 0) {
      const written = await upsertSavingsRateRows(env.DB, accepted)
      await recordLenderDatasetWriteStats(env.DB, {
        runId: job.runId,
        lenderCode: job.lenderCode,
        dataset: 'savings',
        acceptedRows: accepted.length,
        writtenRows: written,
        droppedRows: dropped.length,
        detailFetchEventCount: parsedProductIds.length,
      })
      for (let i = 0; i < parsedProductIds.length; i += 1) {
        await markLenderDatasetDetailProcessed(env.DB, {
          runId: job.runId,
          lenderCode: job.lenderCode,
          dataset: 'savings',
        })
      }
    }
    await persistRawPayload(env, {
      sourceType: 'cdr_products',
      sourceUrl: 'summary://ubank/savings',
      payload: {
        lenderCode: job.lenderCode,
        runId: job.runId,
        collectionDate: job.collectionDate,
        fetchedAt: nowIso(),
        acceptedRows: accepted.length,
        rejectedRows: dropped.length,
        droppedReasons,
        inspected: parsed.inspected,
        droppedByParser: parsed.dropped,
        observedUpstreamStatuses,
        upstreamBlocks: observedUpstreamBlocks,
        pages: pageResults.map((page) => ({
          url: page.url,
          status: page.status,
          fetch_event_id: page.fetchEventId,
        })),
        timings: {
          totalMs: elapsedMs(startedAt),
        },
      },
      httpStatus: accepted.length > 0 ? 200 : 204,
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
      jobKind: 'daily_deposit_index_fetch',
      collectionDate: job.collectionDate,
      notes: `ubank_savings_fallback lender=${job.lenderCode}`,
    })
    await finalizeLenderDatasetIfReady(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'savings',
    })
  }

  if (selectedDatasets.has('term_deposits')) {
    await setLenderDatasetExpectedDetails(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
      bankName: lender.canonical_bank_name,
      collectionDate: job.collectionDate,
      expectedDetailCount: 0,
    })
    await markLenderDatasetIndexFetchSucceeded(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
    })
    await recordLenderDatasetWriteStats(env.DB, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
      acceptedRows: 0,
      writtenRows: 0,
      droppedRows: 0,
    })
    await persistRawPayload(env, {
      sourceType: 'cdr_products',
      sourceUrl: 'summary://ubank/term-deposits',
      payload: {
        lenderCode: job.lenderCode,
        runId: job.runId,
        collectionDate: job.collectionDate,
        fetchedAt: nowIso(),
        reason: 'ubank_term_deposits_not_offered',
      },
      httpStatus: 204,
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
      jobKind: 'daily_deposit_index_fetch',
      collectionDate: job.collectionDate,
      notes: `ubank_td_fallback lender=${job.lenderCode}`,
    })
    await finalizeLenderDatasetIfReady(env, {
      runId: job.runId,
      lenderCode: job.lenderCode,
      dataset: 'term_deposits',
    })
  }

  log.info('consumer', 'daily_savings_lender_fetch ubank_fallback_completed', {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context:
      `datasets=${serializeForLog(Array.from(selectedDatasets))}` +
      ` statuses=${serializeForLog(observedUpstreamStatuses)}` +
      ` pages=${pageResults.length} total_ms=${elapsedMs(startedAt)}`,
  })
}
