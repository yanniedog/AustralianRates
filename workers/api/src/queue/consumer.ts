import { DEFAULT_MAX_QUEUE_ATTEMPTS, TARGET_LENDERS } from '../constants'
import { upsertHistoricalRateRows } from '../db/historical-rates'
import { getCachedEndpoint } from '../db/endpoint-cache'
import { persistRawPayload } from '../db/raw-payloads'
import { recordRunQueueOutcome } from '../db/run-reports'
import {
  backfillSeedProductRows,
  buildBackfillCursorKey,
  cdrCollectionNotes,
  fetchProductDetailRows,
  fetchResidentialMortgageProductIds,
} from '../ingest/cdr'
import type { BackfillSnapshotJob, DailyLenderJob, EnvBindings, IngestMessage, ProductDetailJob } from '../types'
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

async function handleDailyLenderJob(env: EnvBindings, job: DailyLenderJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }

  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const sourceUrl = endpoint?.endpointUrl || ''
  const collectedRows = []

  if (sourceUrl) {
    const products = await fetchResidentialMortgageProductIds(sourceUrl)
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
        endpointUrl: sourceUrl,
        productId,
        collectionDate: job.collectionDate,
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
      const rates = extractRatesFromHtml(seedUrl, html, lender, job.collectionDate, 'scraped_fallback')
      for (const row of rates) {
        collectedRows.push(row)
      }
    }
  }

  await upsertHistoricalRateRows(env.DB, collectedRows)

  await persistRawPayload(env, {
    sourceType: 'cdr_products',
    sourceUrl: sourceUrl || `fallback://${job.lenderCode}`,
    payload: {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      productsRows: collectedRows.length,
    },
    httpStatus: 200,
    notes: cdrCollectionNotes(collectedRows.length, collectedRows.length),
  })
}

async function handleProductDetailJob(env: EnvBindings, job: ProductDetailJob): Promise<void> {
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!endpoint || !lender) {
    return
  }

  const details = await fetchProductDetailRows({
    lender,
    endpointUrl: endpoint.endpointUrl,
    productId: job.productId,
    collectionDate: job.collectionDate,
  })

  await persistRawPayload(env, {
    sourceType: 'cdr_product_detail',
    sourceUrl: details.rawPayload.sourceUrl,
    payload: details.rawPayload.body,
    httpStatus: details.rawPayload.status,
    notes: `direct_product_detail lender=${job.lenderCode} product=${job.productId}`,
  })
  await upsertHistoricalRateRows(env.DB, details.rows)
}

async function handleBackfillSnapshotJob(env: EnvBindings, job: BackfillSnapshotJob): Promise<void> {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode)
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`)
  }

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
    const rateRows = extractRatesFromHtml(snapshotUrl, html, lender, collectionDate, 'parsed_from_wayback')
    writtenRows += await upsertHistoricalRateRows(env.DB, rateRows)
  }

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
      writtenRows > 0 ? 'completed' : 'empty',
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

  for (const msg of batch.messages) {
    const attempts = Number(msg.attempts || 1)
    const body = msg.body
    const context = extractRunContext(body)

    try {
      if (!isIngestMessage(body)) {
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

      if (attempts >= maxAttempts) {
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

function extractRatesFromHtml(
  sourceUrl: string,
  html: string,
  lender: (typeof TARGET_LENDERS)[number],
  collectionDate: string,
  qualityFlag: string,
) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

  const regex = /([A-Za-z0-9&()\-\/ ,]{4,120})\s+([0-9]{1,2}(?:\.[0-9]{1,3})?)\s*%/g
  const rows: Array<ReturnType<typeof backfillSeedProductRows>> = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = regex.exec(cleaned)) !== null && rows.length < 30) {
    const name = String(match[1] || '').trim().slice(-80)
    const rate = Number(match[2])
    if (!name || !Number.isFinite(rate)) continue
    const key = `${name}|${rate}`
    if (seen.has(key)) continue
    seen.add(key)
    const row = backfillSeedProductRows({
      lender,
      collectionDate,
      sourceUrl,
      productName: name,
      rate,
    })
    row.dataQualityFlag = qualityFlag
    rows.push(row)
  }

  return rows
}