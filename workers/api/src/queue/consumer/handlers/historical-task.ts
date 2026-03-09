import { TARGET_LENDERS } from '../../../constants'
import { addHistoricalTaskBatchCounts, claimHistoricalTaskById, finalizeHistoricalTask, getHistoricalRunById } from '../../../db/client-historical-runs'
import { recordDatasetCoverageRunOutcome } from '../../../db/dataset-coverage'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { persistRawPayload } from '../../../db/raw-payloads'
import { upsertSavingsRateRows } from '../../../db/savings-rates'
import { upsertTdRateRows } from '../../../db/td-rates'
import { discoverProductsEndpoint } from '../../../ingest/cdr'
import { candidateProductEndpoints } from '../../../ingest/product-endpoints'
import { collectHistoricalDayFromWayback } from '../../../ingest/wayback-historical'
import type { EnvBindings, HistoricalTaskExecuteJob } from '../../../types'
import { log } from '../../../utils/logger'
import { nowIso, parseIntegerEnv } from '../../../utils/time'
import { asHistoricalScope, rowsWrittenForScope, scopeCoverageDataset } from '../historical-scope'
import { assignFetchEventIdsBySourceUrl } from '../lineage'
import { elapsedMs, serializeForLog, summarizeStatusCodes } from '../log-helpers'
import { maxProductsPerLender } from '../retry-config'
import { splitValidatedRows, splitValidatedSavingsRows, splitValidatedTdRows } from '../validation'

export async function handleHistoricalTaskJob(env: EnvBindings, job: HistoricalTaskExecuteJob): Promise<void> {
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
    const payloadFetchEventIdBySourceUrl = new Map<string, number>()
    const endpointDiscoveryStartedAt = Date.now()
    const endpoint = await getCachedEndpoint(env.DB, task.lender_code)
    const discovered = await discoverProductsEndpoint(lender, {
      env,
      runId: job.runId,
      lenderCode: task.lender_code,
    })
    const uniqueEndpointCandidates = candidateProductEndpoints({
      cachedEndpointUrl: endpoint?.endpointUrl,
      lender,
      discoveredEndpointUrl: discovered?.endpointUrl,
    })
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
      const persisted = await persistRawPayload(env, {
        sourceType: 'wayback_html',
        sourceUrl: payload.sourceUrl,
        payload: payload.payload,
        httpStatus: payload.status,
        notes: `${payload.notes} run=${job.runId} task=${task.task_id} scope=${scope}`,
      })
      if (persisted.fetchEventId != null) {
        payloadFetchEventIdBySourceUrl.set(payload.sourceUrl, persisted.fetchEventId)
      }
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
    assignFetchEventIdsBySourceUrl(mortgageRows, payloadFetchEventIdBySourceUrl)
    assignFetchEventIdsBySourceUrl(savingsRows, payloadFetchEventIdBySourceUrl)
    assignFetchEventIdsBySourceUrl(tdRows, payloadFetchEventIdBySourceUrl)

    const validateStartedAt = Date.now()
    const { accepted: mortgageAccepted, dropped: mortgageDropped } = splitValidatedRows(mortgageRows)
    const { accepted: savingsAccepted, dropped: savingsDropped } = splitValidatedSavingsRows(savingsRows)
    const { accepted: tdAccepted, dropped: tdDropped } = splitValidatedTdRows(tdRows)
    const mortgageDroppedReasons: Record<string, number> = {}
    const savingsDroppedReasons: Record<string, number> = {}
    const tdDroppedReasons: Record<string, number> = {}
    for (const item of mortgageDropped) mortgageDroppedReasons[item.reason] = (mortgageDroppedReasons[item.reason] || 0) + 1
    for (const item of savingsDropped) savingsDroppedReasons[item.reason] = (savingsDroppedReasons[item.reason] || 0) + 1
    for (const item of tdDropped) tdDroppedReasons[item.reason] = (tdDroppedReasons[item.reason] || 0) + 1
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
    const noSignalEmptyHistoricalTask = historicalParsedTotal === 0 && historicalWrittenTotal === 0 && !hadSignals
    const historicalShouldWarn = historicalWrittenTotal === 0 && !noSignalEmptyHistoricalTask

    if (historicalParsedTotal === 0 && historicalWrittenTotal === 0) {
      const emptyResultLog = noSignalEmptyHistoricalTask ? log.info : log.warn
      emptyResultLog('consumer', 'historical_task_execute empty_result', {
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
