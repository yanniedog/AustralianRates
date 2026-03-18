import { TARGET_LENDERS } from '../constants'
import { resolveFetchEventIdByPayloadIdentity } from '../db/fetch-events'
import type { EnvBindings } from '../types'
import type { DatasetKind } from '../../../../packages/shared/src'

type DatasetTable = {
  dataset: DatasetKind
  table: 'historical_loan_rates' | 'historical_savings_rates' | 'historical_term_deposit_rates'
}

type RepairEnv = Pick<EnvBindings, 'DB' | 'RAW_BUCKET'>

type BaseUrlCandidate = {
  runId: string
  collectionDate: string
  bankName: string
  baseUrl: string
  anchorTs: string
  rowCount: number
  sourceUrls: string[]
}

type ExistingFetchEventRow = {
  id: number
  run_id: string | null
  lender_code: string | null
  dataset_kind: string | null
  source_url: string | null
  fetched_at: string | null
  http_status: number | null
}

type RawPayloadRow = {
  id: number
  source_type: string
  source_url: string
  fetched_at: string
  content_hash: string
  r2_key: string
  http_status: number | null
  notes: string | null
  body_bytes: number | null
  content_type: string | null
}

const RAW_PAYLOAD_WINDOW_MS = 72 * 60 * 60 * 1000
const BATCH_SIZE = 70
const BANK_NAME_TO_LENDER_CODE = new Map<string, string>(
  TARGET_LENDERS.flatMap((lender) => {
    const keys = new Set(
      [String(lender.canonical_bank_name || '').trim(), String(lender.name || '').trim()]
        .filter(Boolean)
        .map((value) => value.toLowerCase()),
    )
    return Array.from(keys).map((key) => [key, lender.code] as const)
  }),
)

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const normalized = value.includes('T') || value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function inferContentType(sourceType: string): string {
  return sourceType === 'wayback_html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
}

function notePreferenceScore(dataset: DatasetKind, notes: string | null | undefined): number {
  const text = String(notes || '').toLowerCase()
  if (!text) return 9
  if (dataset === 'home_loans') {
    if (text.includes('daily_product_index')) return 0
    if (text.includes('cdr_collection')) return 1
    return 2
  }
  if (text.includes('savings_td_product_index')) return 0
  if (text.includes('cdr_collection')) return 1
  if (text.includes('daily_product_index')) return 2
  return 3
}

function datasetPreferenceScore(dataset: DatasetKind, candidateDataset: string | null | undefined): number {
  if (candidateDataset === dataset) return 0
  if (dataset === 'term_deposits' && candidateDataset === 'savings') return 1
  return 9
}

function httpStatusPreference(status: number | null | undefined): number {
  const code = Number(status ?? 0)
  if (code === 200) return 0
  if (code >= 200 && code < 300) return 1
  return 2
}

export function baseProductsSourceUrl(sourceUrl: string | null | undefined): string | null {
  const value = String(sourceUrl || '').trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    const pathname = parsed.pathname
    const lastSlash = pathname.lastIndexOf('/')
    if (lastSlash <= 0) return null
    parsed.pathname = pathname.slice(0, lastSlash)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

export function parseLegacyRawPayloadLenderCode(notes: string | null | undefined): string | null {
  const match = String(notes || '').match(/\blender=([a-z0-9_]+)/i)
  return match ? String(match[1]).toLowerCase() : null
}

function lenderCodeForBankName(bankName: string | null | undefined): string | null {
  const normalized = String(bankName || '').trim().toLowerCase()
  if (!normalized) return null
  return BANK_NAME_TO_LENDER_CODE.get(normalized) ?? null
}

export function resolveSyntheticLenderCode(
  candidate: Pick<BaseUrlCandidate, 'bankName'>,
  rawPayload: Pick<RawPayloadRow, 'notes'>,
): string | null {
  return lenderCodeForBankName(candidate.bankName) ?? parseLegacyRawPayloadLenderCode(rawPayload.notes)
}

export function pickPreferredExistingListFetchEvent(
  rows: ExistingFetchEventRow[],
  dataset: DatasetKind,
  preferredLenderCode?: string | null,
): ExistingFetchEventRow | null {
  const eligible = rows.filter((row) => {
    if (datasetPreferenceScore(dataset, row.dataset_kind) >= 9) return false
    if (!preferredLenderCode) return true
    const lenderCode = String(row.lender_code || '').trim().toLowerCase()
    return !lenderCode || lenderCode === preferredLenderCode
  })
  if (eligible.length === 0) return null
  const sorted = eligible.slice().sort((left, right) => {
    const leftScore = httpStatusPreference(left.http_status) * 10 + datasetPreferenceScore(dataset, left.dataset_kind)
    const rightScore = httpStatusPreference(right.http_status) * 10 + datasetPreferenceScore(dataset, right.dataset_kind)
    if (leftScore !== rightScore) return leftScore - rightScore
    const timeDiff = timestampMs(right.fetched_at) - timestampMs(left.fetched_at)
    if (timeDiff !== 0) return timeDiff
    return Number(right.id) - Number(left.id)
  })
  return sorted[0] ?? null
}

export function pickPreferredRawPayloadListRow(
  rows: RawPayloadRow[],
  anchorTs: string,
  dataset: DatasetKind,
): RawPayloadRow | null {
  const anchorMs = timestampMs(anchorTs)
  const eligible = rows.filter((row) => {
    if (row.source_type !== 'cdr_products') return false
    const diff = Math.abs(timestampMs(row.fetched_at) - anchorMs)
    return diff <= RAW_PAYLOAD_WINDOW_MS
  })
  if (eligible.length === 0) return null

  const sorted = eligible.slice().sort((left, right) => {
    const leftScore = notePreferenceScore(dataset, left.notes)
    const rightScore = notePreferenceScore(dataset, right.notes)
    if (leftScore !== rightScore) return leftScore - rightScore
    const leftDiff = Math.abs(timestampMs(left.fetched_at) - anchorMs)
    const rightDiff = Math.abs(timestampMs(right.fetched_at) - anchorMs)
    if (leftDiff !== rightDiff) return leftDiff - rightDiff
    return Number(right.id) - Number(left.id)
  })
  return sorted[0] ?? null
}

async function loadBaseUrlCandidates(
  db: D1Database,
  target: DatasetTable,
  cutoffDate: string,
): Promise<BaseUrlCandidate[]> {
  const result = await db
    .prepare(
      `SELECT run_id, collection_date, bank_name, source_url, parsed_at
       FROM ${target.table}
       WHERE fetch_event_id IS NULL
         AND collection_date >= ?1
         AND run_id IS NOT NULL
         AND TRIM(run_id) != ''
         AND source_url IS NOT NULL
         AND TRIM(source_url) != ''`,
    )
    .bind(cutoffDate)
    .all<Record<string, unknown>>()

  const grouped = new Map<string, BaseUrlCandidate & { sourceSet: Set<string> }>()
  for (const row of result.results ?? []) {
    const runId = String(row.run_id || '').trim()
    const collectionDate = String(row.collection_date || '').trim()
    const bankName = String(row.bank_name || '').trim()
    const sourceUrl = String(row.source_url || '').trim()
    const baseUrl = baseProductsSourceUrl(sourceUrl)
    if (!runId || !collectionDate || !bankName || !sourceUrl || !baseUrl) continue

    const parsedAt = String(row.parsed_at || '').trim()
    const anchorTs = parsedAt || `${collectionDate}T00:00:00Z`
    const key = `${runId}|${collectionDate}|${bankName}|${baseUrl}`
    const current = grouped.get(key)
    if (!current) {
      grouped.set(key, {
        runId,
        collectionDate,
        bankName,
        baseUrl,
        anchorTs,
        rowCount: 1,
        sourceUrls: [],
        sourceSet: new Set([sourceUrl]),
      })
      continue
    }

    current.rowCount += 1
    if (timestampMs(anchorTs) > timestampMs(current.anchorTs)) {
      current.anchorTs = anchorTs
    }
    current.sourceSet.add(sourceUrl)
  }

  return Array.from(grouped.values())
    .map((candidate) => ({
      runId: candidate.runId,
      collectionDate: candidate.collectionDate,
      bankName: candidate.bankName,
      baseUrl: candidate.baseUrl,
      anchorTs: candidate.anchorTs,
      rowCount: candidate.rowCount,
      sourceUrls: Array.from(candidate.sourceSet).sort(),
    }))
    .sort((left, right) => left.runId.localeCompare(right.runId) || left.baseUrl.localeCompare(right.baseUrl))
}

async function loadExistingListFetchEvents(db: D1Database, runIds: string[]): Promise<ExistingFetchEventRow[]> {
  const rows: ExistingFetchEventRow[] = []
  for (const batch of chunkValues(runIds, BATCH_SIZE)) {
    if (batch.length === 0) continue
    const placeholders = batch.map(() => '?').join(', ')
    const result = await db
      .prepare(
        `SELECT id, run_id, lender_code, dataset_kind, source_url, fetched_at, http_status
         FROM fetch_events
         WHERE source_type = 'cdr_products'
           AND run_id IN (${placeholders})`,
      )
      .bind(...batch)
      .all<ExistingFetchEventRow>()
    rows.push(...(result.results ?? []))
  }
  return rows
}

async function loadRawPayloadListRows(db: D1Database, baseUrls: string[]): Promise<RawPayloadRow[]> {
  const rows: RawPayloadRow[] = []
  for (const batch of chunkValues(baseUrls, BATCH_SIZE)) {
    if (batch.length === 0) continue
    const placeholders = batch.map(() => '?').join(', ')
    const result = await db
      .prepare(
        `SELECT
           rp.id,
           rp.source_type,
           rp.source_url,
           rp.fetched_at,
           rp.content_hash,
           rp.r2_key,
           rp.http_status,
           rp.notes,
           ro.body_bytes,
           ro.content_type
         FROM raw_payloads rp
         LEFT JOIN raw_objects ro
           ON ro.content_hash = rp.content_hash
         WHERE rp.source_type = 'cdr_products'
           AND rp.source_url IN (${placeholders})`,
      )
      .bind(...batch)
      .all<RawPayloadRow>()
    rows.push(...(result.results ?? []))
  }
  return rows
}

async function ensureRawObjectMetadata(
  env: RepairEnv,
  rawPayload: RawPayloadRow,
): Promise<{ bodyBytes: number; contentType: string } | null> {
  if (Number(rawPayload.body_bytes ?? 0) > 0 && rawPayload.content_type) {
    return {
      bodyBytes: Number(rawPayload.body_bytes),
      contentType: String(rawPayload.content_type),
    }
  }

  const object = await env.RAW_BUCKET.head(rawPayload.r2_key)
  if (!object) return null

  const bodyBytes = Number(object.size ?? 0)
  const contentType = object.httpMetadata?.contentType || inferContentType(rawPayload.source_type)
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO raw_objects (
         content_hash,
         source_type,
         first_source_url,
         body_bytes,
         content_type,
         r2_key,
         created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      rawPayload.content_hash,
      rawPayload.source_type,
      rawPayload.source_url,
      bodyBytes,
      contentType,
      rawPayload.r2_key,
      rawPayload.fetched_at,
    )
    .run()

  return { bodyBytes, contentType }
}

async function ensureSyntheticListFetchEvent(
  env: RepairEnv,
  target: DatasetTable,
  candidate: BaseUrlCandidate,
  rawPayload: RawPayloadRow,
): Promise<number | null> {
  const lenderCode = resolveSyntheticLenderCode(candidate, rawPayload)
  const existingId = await resolveFetchEventIdByPayloadIdentity(env.DB, {
    runId: candidate.runId,
    lenderCode,
    dataset: target.dataset,
    sourceType: 'cdr_products',
    sourceUrl: candidate.baseUrl,
    contentHash: rawPayload.content_hash,
    productId: null,
    collectionDate: candidate.collectionDate,
  })
  if (existingId != null) return existingId

  const rawObjectMeta = await ensureRawObjectMetadata(env, rawPayload)
  if (!rawObjectMeta) return null

  const inserted = await env.DB
    .prepare(
      `INSERT INTO fetch_events (
         run_id,
         lender_code,
         dataset_kind,
         source_type,
         source_url,
         collection_date,
         fetched_at,
         http_status,
         content_hash,
         product_id,
         raw_object_created
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      candidate.runId,
      lenderCode,
      target.dataset,
      'cdr_products',
      candidate.baseUrl,
      candidate.collectionDate,
      rawPayload.fetched_at,
      rawPayload.http_status == null ? null : Number(rawPayload.http_status),
      rawPayload.content_hash,
      null,
      0,
    )
    .run()

  return Number(inserted.meta?.last_row_id ?? 0) || null
}

async function updateCandidateRows(
  db: D1Database,
  table: DatasetTable['table'],
  candidate: BaseUrlCandidate,
  fetchEventId: number,
): Promise<number> {
  let changed = 0
  for (const batch of chunkValues(candidate.sourceUrls, BATCH_SIZE)) {
    if (batch.length === 0) continue
    const placeholders = batch.map((_, index) => `?${index + 4}`).join(', ')
    const result = await db
      .prepare(
        `UPDATE ${table}
         SET fetch_event_id = ?1
         WHERE fetch_event_id IS NULL
           AND collection_date = ?2
           AND run_id = ?3
           AND source_url IN (${placeholders})`,
      )
      .bind(fetchEventId, candidate.collectionDate, candidate.runId, ...batch)
      .run()
    changed += Number(result.meta?.changes ?? 0)
  }
  return changed
}

export async function repairMissingFetchEventLineageByBaseUrl(
  env: RepairEnv,
  target: DatasetTable,
  cutoffDate: string,
  dryRun: boolean,
): Promise<number> {
  const candidates = await loadBaseUrlCandidates(env.DB, target, cutoffDate)
  if (candidates.length === 0) return 0

  const runIds = Array.from(new Set(candidates.map((candidate) => candidate.runId)))
  const baseUrls = Array.from(new Set(candidates.map((candidate) => candidate.baseUrl)))
  const existingFetchEvents = await loadExistingListFetchEvents(env.DB, runIds)
  const rawPayloadRows = await loadRawPayloadListRows(env.DB, baseUrls)

  const existingByRunAndUrl = new Map<string, ExistingFetchEventRow[]>()
  for (const row of existingFetchEvents) {
    const runId = String(row.run_id || '').trim()
    const sourceUrl = String(row.source_url || '').trim()
    if (!runId || !sourceUrl) continue
    const key = `${runId}|${sourceUrl}`
    const current = existingByRunAndUrl.get(key) || []
    current.push(row)
    existingByRunAndUrl.set(key, current)
  }

  const rawPayloadsByUrl = new Map<string, RawPayloadRow[]>()
  for (const row of rawPayloadRows) {
    const key = String(row.source_url || '').trim()
    if (!key) continue
    const current = rawPayloadsByUrl.get(key) || []
    current.push(row)
    rawPayloadsByUrl.set(key, current)
  }

  let repairedRows = 0
  for (const candidate of candidates) {
    const existingKey = `${candidate.runId}|${candidate.baseUrl}`
    const preferredLenderCode = lenderCodeForBankName(candidate.bankName)
    const existingRow = pickPreferredExistingListFetchEvent(
      existingByRunAndUrl.get(existingKey) || [],
      target.dataset,
      preferredLenderCode,
    )

    if (existingRow) {
      if (dryRun) {
        repairedRows += candidate.rowCount
      } else {
        repairedRows += await updateCandidateRows(env.DB, target.table, candidate, Number(existingRow.id))
      }
      continue
    }

    const rawPayload = pickPreferredRawPayloadListRow(rawPayloadsByUrl.get(candidate.baseUrl) || [], candidate.anchorTs, target.dataset)
    if (!rawPayload) continue

    if (dryRun) {
      repairedRows += candidate.rowCount
      continue
    }

    const fetchEventId = await ensureSyntheticListFetchEvent(env, target, candidate, rawPayload)
    if (fetchEventId == null) continue
    repairedRows += await updateCandidateRows(env.DB, target.table, candidate, fetchEventId)
  }

  return repairedRows
}
