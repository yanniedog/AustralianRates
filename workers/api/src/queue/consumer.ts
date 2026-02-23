import { DEFAULT_MAX_QUEUE_ATTEMPTS, TARGET_LENDERS } from '../constants'
import { upsertHistoricalRateRows } from '../db/historical-rates'
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
import { extractLenderRatesFromHtml } from '../ingest/html-rate-parser'
import { getLenderPlaybook } from '../ingest/lender-playbooks'
import { type NormalizedRateRow, validateNormalizedRow } from '../ingest/normalize'
import type { BackfillSnapshotJob, DailyLenderJob, EnvBindings, IngestMessage, ProductDetailJob } from '../types'
import { log } from '../utils/logger'
import { nowIso, parseIntegerEnv } from '../utils/time'

export function calculateRetryDelaySeconds(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts))
  return Math.min(900, 15 * Math.pow(2, safeAttempt - 1))
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

async function handleDailyLenderJob(env: EnvBindings, job: DailyLenderJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }
  log.info('consumer', `daily_lender_fetch started`, { runId: job.runId, lenderCode: job.lenderCode })

  const playbook = getLenderPlaybook(lender)
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  let sourceUrl = ''
  const endpointCandidates: string[] = []
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl)
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint)
  const discovered = await discoverProductsEndpoint(lender)
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl)
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)))

  const collectedRows: NormalizedRateRow[] = []
  let inspectedHtml = 0
  let droppedByParser = 0

  for (const candidateEndpoint of uniqueCandidates) {
    const products = await fetchResidentialMortgageProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions })
    for (const payload of products.rawPayloads) {
      await persistRawPayload(env, {
        sourceType: 'cdr_products',
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        notes: `daily_product_index lender=${job.lenderCode}`,
      })
    }

    const productIds = products.productIds.slice(0, 250)
    for (const productId of productIds) {
      const details = await fetchProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions,
      })

      await persistRawPayload(env, {
        sourceType: 'cdr_product_detail',
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `daily_product_detail lender=${job.lenderCode} product=${productId}`,
      })

      for (const row of details.rows) {
        collectedRows.push(row)
      }
    }
    if (collectedRows.length > 0) {
      sourceUrl = candidateEndpoint
      break
    }
  }

  if (collectedRows.length === 0) {
    for (const seedUrl of lender.seed_rate_urls.slice(0, 2)) {
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
    }
  }

  const { accepted, dropped } = splitValidatedRows(collectedRows)
  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  if (accepted.length === 0) {
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
        inspectedHtml,
        droppedByParser,
      },
      httpStatus: 422,
      notes: `daily_quality_rejected lender=${job.lenderCode}`,
    })
    log.warn('consumer', `daily_ingest_no_valid_rows`, { runId: job.runId, lenderCode: job.lenderCode })
    throw new Error(`daily_ingest_no_valid_rows:${job.lenderCode}`)
  }

  const written = await upsertHistoricalRateRows(env.DB, accepted)
  log.info('consumer', `daily_lender_fetch completed: ${written} written, ${dropped.length} dropped`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context: `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length}`,
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
      inspectedHtml,
      droppedByParser,
    },
    httpStatus: 200,
    notes: cdrCollectionNotes(collectedRows.length, accepted.length),
  })
}

async function handleProductDetailJob(env: EnvBindings, job: ProductDetailJob): Promise<void> {
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!endpoint || !lender) {
    log.warn('consumer', `product_detail_fetch skipped: missing endpoint or lender`, { runId: job.runId, lenderCode: job.lenderCode })
    return
  }
  log.info('consumer', `product_detail_fetch started for ${job.productId}`, { runId: job.runId, lenderCode: job.lenderCode })

  const details = await fetchProductDetailRows({
    lender,
    endpointUrl: endpoint.endpointUrl,
    productId: job.productId,
    collectionDate: job.collectionDate,
    cdrVersions: getLenderPlaybook(lender).cdrVersions,
  })

  await persistRawPayload(env, {
    sourceType: 'cdr_product_detail',
    sourceUrl: details.rawPayload.sourceUrl,
    payload: details.rawPayload.body,
    httpStatus: details.rawPayload.status,
    notes: `direct_product_detail lender=${job.lenderCode} product=${job.productId}`,
  })
  const { accepted } = splitValidatedRows(details.rows)
  for (const row of accepted) {
    row.runId = job.runId
    row.runSource = job.runSource ?? 'scheduled'
  }
  if (accepted.length > 0) {
    await upsertHistoricalRateRows(env.DB, accepted)
  }
}

async function handleBackfillSnapshotJob(env: EnvBindings, job: BackfillSnapshotJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }
  log.info('consumer', `backfill_snapshot_fetch started month=${job.monthCursor}`, { runId: job.runId, lenderCode: job.lenderCode })

  const [year, month] = job.monthCursor.split('-')
  const from = `${year}${month}01`
  const to = `${year}${month}31`
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    job.seedUrl,
  )}&from=${from}&to=${to}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&collapse=digest&limit=8`
  const cdxResponse = await fetch(cdxUrl)
  const cdxBody = await cdxResponse.text()

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: cdxUrl,
    payload: cdxBody,
    httpStatus: cdxResponse.status,
    notes: `wayback_cdx lender=${job.lenderCode} month=${job.monthCursor}`,
  })

  const rows: Array<Array<string>> = []
  try {
    const parsed = JSON.parse(cdxBody)
    if (Array.isArray(parsed)) {
      for (let i = 1; i < parsed.length; i += 1) {
        if (Array.isArray(parsed[i])) rows.push((parsed[i] as unknown[]).map((x: unknown) => String(x)))
      }
    }
  } catch {
    // keep rows empty
  }

  let writtenRows = 0
  let inspectedTotal = 0
  let droppedTotal = 0
  for (const entry of rows.slice(0, 5)) {
    const timestamp = entry[0]
    const original = entry[1] || job.seedUrl
    if (!timestamp) continue
    const snapshotUrl = `https://web.archive.org/web/${timestamp}/${original}`
    const snapshotResponse = await fetch(snapshotUrl)
    const html = await snapshotResponse.text()

    await persistRawPayload(env, {
      sourceType: 'wayback_html',
      sourceUrl: snapshotUrl,
      payload: html,
      httpStatus: snapshotResponse.status,
      notes: `wayback_snapshot lender=${job.lenderCode}`,
    })

    const collectionDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`
    const parsed = extractLenderRatesFromHtml({
      lender,
      html,
      sourceUrl: snapshotUrl,
      collectionDate,
      mode: 'historical',
      qualityFlag: 'parsed_from_wayback_strict',
    })
    inspectedTotal += parsed.inspected
    droppedTotal += parsed.dropped
    const { accepted, dropped } = splitValidatedRows(parsed.rows)
    for (const row of accepted) {
      row.runId = job.runId
      row.runSource = job.runSource ?? 'scheduled'
    }
    droppedTotal += dropped.length
    if (accepted.length > 0) {
      writtenRows += await upsertHistoricalRateRows(env.DB, accepted)
    }
  }

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: job.seedUrl,
    payload: {
      runId: job.runId,
      lenderCode: job.lenderCode,
      monthCursor: job.monthCursor,
      writtenRows,
      inspectedTotal,
      droppedTotal,
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

  const exhaustive: never = message
  throw new Error(`Unsupported message kind: ${String(exhaustive)}`)
}

export async function consumeIngestQueue(batch: MessageBatch<IngestMessage>, env: EnvBindings): Promise<void> {
  const maxAttempts = parseIntegerEnv(env.MAX_QUEUE_ATTEMPTS, DEFAULT_MAX_QUEUE_ATTEMPTS)
  log.info('consumer', `queue_batch received ${batch.messages.length} messages`)

  for (const msg of batch.messages) {
    const attempts = Number(msg.attempts || 1)
    const body = msg.body
    const context = extractRunContext(body)

    try {
      if (!isIngestMessage(body)) {
        log.error('consumer', 'invalid_queue_message_shape', { context: JSON.stringify(body) })
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
    } catch (error) {
      const errorMessage = (error as Error)?.message || String(error)
      log.error('consumer', `queue_message_failed attempt=${attempts}/${maxAttempts}: ${errorMessage}`, {
        runId: context.runId ?? undefined,
        lenderCode: context.lenderCode ?? undefined,
      })

      if (attempts >= maxAttempts) {
        log.error('consumer', `queue_message_exhausted max_attempts=${maxAttempts}`, {
          runId: context.runId ?? undefined,
          lenderCode: context.lenderCode ?? undefined,
          context: errorMessage,
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
        continue
      }

      msg.retry({
        delaySeconds: calculateRetryDelaySeconds(attempts),
      })
    }
  }
}