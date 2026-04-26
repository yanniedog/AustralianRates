import { TARGET_LENDERS } from '../../../constants'
import { upsertHistoricalRateRows } from '../../../db/historical-rates'
import { persistRawPayload } from '../../../db/raw-payloads'
import { buildBackfillCursorKey } from '../../../ingest/cdr'
import { extractLenderRatesFromHtml } from '../../../ingest/html-rate-parser'
import type { BackfillSnapshotJob, EnvBindings } from '../../../types'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../../../utils/fetch-with-timeout'
import { log } from '../../../utils/logger'
import { nowIso } from '../../../utils/time'
import { elapsedMs, mergeSummary, serializeForLog, shortUrlForLog } from '../log-helpers'
import { splitValidatedRows } from '../validation'

export async function handleBackfillSnapshotJob(env: EnvBindings, job: BackfillSnapshotJob): Promise<void> {
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
  let cdxResponse: Response
  try {
    const fetched = await fetchWithTimeout(cdxUrl, undefined, { env })
    cdxResponse = fetched.response
    log.info('consumer', 'upstream_fetch', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `source=wayback_cdx host=${hostFromUrl(cdxUrl)}` +
        ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
        ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
        ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
        ` status=${fetched.meta.status ?? cdxResponse.status}`,
    })
  } catch (error) {
    const meta = error instanceof FetchWithTimeoutError ? error.meta : null
    log.warn('consumer', 'upstream_fetch', {
      runId: job.runId,
      lenderCode: job.lenderCode,
      context:
        `source=wayback_cdx host=${hostFromUrl(cdxUrl)}` +
        ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
        ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
        ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
        ` status=${meta?.status ?? 0}`,
    })
    throw error
  }
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
    let snapshotResponse: Response
    try {
      const fetched = await fetchWithTimeout(snapshotUrl, undefined, { env })
      snapshotResponse = fetched.response
      log.info('consumer', 'upstream_fetch', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `source=wayback_snapshot host=${hostFromUrl(snapshotUrl)}` +
          ` elapsed_ms=${fetched.meta.elapsed_ms} upstream_ms=${fetched.meta.elapsed_ms}` +
          ` attempts=${fetched.meta.attempts} retry_count=${Math.max(0, fetched.meta.attempts - 1)}` +
          ` timed_out=${fetched.meta.timed_out ? 1 : 0} timeout=${fetched.meta.timed_out ? 1 : 0}` +
          ` status=${fetched.meta.status ?? snapshotResponse.status}`,
      })
    } catch (error) {
      const meta = error instanceof FetchWithTimeoutError ? error.meta : null
      log.warn('consumer', 'upstream_fetch', {
        runId: job.runId,
        lenderCode: job.lenderCode,
        context:
          `source=wayback_snapshot host=${hostFromUrl(snapshotUrl)}` +
          ` elapsed_ms=${meta?.elapsed_ms ?? 0} upstream_ms=${meta?.elapsed_ms ?? 0}` +
          ` attempts=${meta?.attempts ?? 1} retry_count=${Math.max(0, (meta?.attempts ?? 1) - 1)}` +
          ` timed_out=${meta?.timed_out ? 1 : 0} timeout=${meta?.timed_out ? 1 : 0}` +
          ` status=${meta?.status ?? 0}`,
      })
      throw error
    }
    const html = await snapshotResponse.text()
    const snapshotFetchMs = elapsedMs(snapshotStartedAt)
    snapshotFetchMsTotal += snapshotFetchMs
    snapshotStatusSummary[String(snapshotResponse.status)] = (snapshotStatusSummary[String(snapshotResponse.status)] || 0) + 1

    const persistedSnapshotPayload = await persistRawPayload(env, {
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
      row.fetchEventId = row.fetchEventId ?? persistedSnapshotPayload.fetchEventId ?? null
    }
    const droppedReasons: Record<string, number> = {}
    for (const item of dropped) droppedReasons[item.reason] = (droppedReasons[item.reason] || 0) + 1
    mergeSummary(validationDroppedReasons, droppedReasons)
    validationDroppedTotal += dropped.length
    let writtenForSnapshot = 0
    if (accepted.length > 0) {
      const writeStartedAt = Date.now()
      const writeResult = await upsertHistoricalRateRows(env.DB, accepted)
      writtenForSnapshot = writeResult.written
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
