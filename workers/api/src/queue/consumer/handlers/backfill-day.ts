import { TARGET_LENDERS } from '../../../constants'
import { advanceAutoBackfillAfterDay, releaseAutoBackfillClaim } from '../../../db/auto-backfill-progress'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { upsertSavingsRateRows } from '../../../db/savings-rates'
import { upsertTdRateRows } from '../../../db/td-rates'
import { getCachedEndpoint } from '../../../db/endpoint-cache'
import { persistRawPayload } from '../../../db/raw-payloads'
import { discoverProductsEndpoint } from '../../../ingest/cdr'
import { collectHistoricalDayFromWayback } from '../../../ingest/wayback-historical'
import type { BackfillDayJob, EnvBindings } from '../../../types'
import { log } from '../../../utils/logger'
import { nowIso } from '../../../utils/time'
import { elapsedMs, serializeForLog, summarizeEndpointHosts, summarizeStatusCodes } from '../log-helpers'
import { maxProductsPerLender } from '../retry-config'
import { splitValidatedRows, splitValidatedSavingsRows, splitValidatedTdRows } from '../validation'

export async function handleBackfillDayJob(env: EnvBindings, job: BackfillDayJob): Promise<void> {
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
    const discovered = await discoverProductsEndpoint(lender, {
      env,
      runId: job.runId,
      lenderCode: job.lenderCode,
    })
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
    const mortgageDroppedReasons: Record<string, number> = {}
    const savingsDroppedReasons: Record<string, number> = {}
    const tdDroppedReasons: Record<string, number> = {}
    for (const item of mortgageDropped) mortgageDroppedReasons[item.reason] = (mortgageDroppedReasons[item.reason] || 0) + 1
    for (const item of savingsDropped) savingsDroppedReasons[item.reason] = (savingsDroppedReasons[item.reason] || 0) + 1
    for (const item of tdDropped) tdDroppedReasons[item.reason] = (tdDroppedReasons[item.reason] || 0) + 1
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
