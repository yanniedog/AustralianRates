import type { DatasetKind } from '../../../../packages/shared/src'
import { TARGET_LENDERS } from '../constants'
import {
  isHealthyDailyLenderDatasetStatusRow,
  lenderDatasetStatusScopeKey,
  listLatestDailyLenderDatasetStatusRows,
} from './lender-dataset-status'

type NumberRow = { n: number | null }
type RunScopeRow = {
  run_id: string
  lender_code: string
  dataset_kind: string
  collection_date: string
}
type ParsedWriteContractLogScope = {
  lenderCode: string
  datasetKind: DatasetKind
  collectionDate: string | null
}
type StatusProgressRow = {
  collection_date: string
  lender_code: string
  dataset_kind: DatasetKind
  updated_at: string | null
  accepted_row_count: number | null
  written_row_count: number | null
  completed_detail_count: number | null
}

function pairKey(runId: string, lenderCode: string): string {
  return `${String(runId || '').trim()}|${String(lenderCode || '').trim().toLowerCase()}`
}

function normalizeLenderText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function lenderCodeFromText(value: string | null | undefined): string | null {
  const normalized = normalizeLenderText(value)
  if (!normalized) return null
  for (const lender of TARGET_LENDERS) {
    const lenderCode = String(lender.code || '').trim()
    const names = [lenderCode, lender.canonical_bank_name, lender.name]
    for (const candidate of names) {
      if (normalizeLenderText(candidate) === normalized) return lenderCode
    }
  }
  return null
}

function datasetFromWriteContractMessage(message: string): DatasetKind | null {
  const normalized = String(message || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.startsWith('savings_upsert_failed')) return 'savings'
  if (normalized.startsWith('term_deposit_upsert_failed')) return 'term_deposits'
  if (normalized.startsWith('upsert_failed')) return 'home_loans'
  return null
}

function collectionDateFromMessage(message: string): string | null {
  const match = /\bdate=(\d{4}-\d{2}-\d{2})\b/i.exec(String(message || ''))
  return match?.[1] ?? null
}

export function parseWriteContractViolationLogScope(entry: Record<string, unknown>): ParsedWriteContractLogScope | null {
  if (String(entry.code || '').trim() !== 'write_contract_violation') return null
  const message = String(entry.message || '')
  const datasetKind = datasetFromWriteContractMessage(message)
  if (!datasetKind) return null
  const lenderCode = lenderCodeFromText(String(entry.lender_code || '')) ?? lenderCodeFromText(/bank=([^=]+?)(?:\s+date=|$)/i.exec(message)?.[1] ?? null)
  if (!lenderCode) return null
  return {
    lenderCode,
    datasetKind,
    collectionDate: collectionDateFromMessage(message),
  }
}

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM sqlite_master
       WHERE type = 'table' AND name = ?1`,
    )
    .bind(table)
    .first<NumberRow>()
  return Number(row?.n ?? 0) > 0
}

export async function getHealthyDailyLenderDatasetScopeSet(db: D1Database): Promise<Set<string>> {
  if (!(await tableExists(db, 'lender_dataset_runs'))) return new Set<string>()
  const latestRows = await listLatestDailyLenderDatasetStatusRows(db, { limit: 2000 })
  return new Set(
    latestRows
      .filter((row) => isHealthyDailyLenderDatasetStatusRow(row))
      .map((row) => lenderDatasetStatusScopeKey(row)),
  )
}

export async function filterResolvedWriteContractViolationLogEntries(
  db: D1Database,
  entries: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const candidatePairs = new Map<string, { runId: string; lenderCode: string }>()
  const parsedScopesByEntry = new Map<Record<string, unknown>, ParsedWriteContractLogScope>()
  for (const entry of entries) {
    if (String(entry.code || '').trim() !== 'write_contract_violation') continue
    const runId = String(entry.run_id || '').trim()
    const lenderCode = String(entry.lender_code || '').trim().toLowerCase()
    if (!runId || !lenderCode) continue
    candidatePairs.set(pairKey(runId, lenderCode), { runId, lenderCode })
  }
  for (const entry of entries) {
    const parsed = parseWriteContractViolationLogScope(entry)
    if (parsed) parsedScopesByEntry.set(entry, parsed)
  }
  if (candidatePairs.size === 0 && parsedScopesByEntry.size === 0) return entries
  if (!(await tableExists(db, 'lender_dataset_runs'))) return entries

  const healthyScopes = await getHealthyDailyLenderDatasetScopeSet(db)
  if (healthyScopes.size === 0 && parsedScopesByEntry.size === 0) return entries

  const uniqueRunIds = Array.from(new Set(Array.from(candidatePairs.values()).map((pair) => pair.runId)))
  const runScopeResult =
    uniqueRunIds.length > 0
      ? await db
          .prepare(
            `SELECT DISTINCT run_id, lender_code, dataset_kind, collection_date
             FROM lender_dataset_runs
             WHERE run_id IN (${uniqueRunIds.map((_, index) => `?${index + 1}`).join(', ')})`,
          )
          .bind(...uniqueRunIds)
          .all<RunScopeRow>()
      : { results: [] as RunScopeRow[] }

  const scopesByPair = new Map<string, Set<string>>()
  for (const row of runScopeResult.results ?? []) {
    const key = pairKey(row.run_id, row.lender_code)
    const bucket = scopesByPair.get(key) ?? new Set<string>()
    bucket.add(
      lenderDatasetStatusScopeKey({
        collection_date: row.collection_date,
        lender_code: row.lender_code,
        dataset_kind: row.dataset_kind as DatasetKind,
      }),
    )
    scopesByPair.set(key, bucket)
  }

  const healthyScopesByLenderDataset = new Set<string>()
  for (const scope of healthyScopes) {
    const [collectionDate, lenderCode, datasetKind] = String(scope || '').split('|')
    if (!lenderCode || !datasetKind) continue
    healthyScopesByLenderDataset.add(`${lenderCode}|${datasetKind}`)
    if (collectionDate) healthyScopesByLenderDataset.add(`${collectionDate}|${lenderCode}|${datasetKind}`)
  }
  const candidateScopeRows = Array.from(parsedScopesByEntry.values())
  const lenderCodes = Array.from(new Set(candidateScopeRows.map((scope) => scope.lenderCode)))
  const datasetKinds = Array.from(new Set(candidateScopeRows.map((scope) => scope.datasetKind)))
  const progressRows =
    lenderCodes.length > 0 && datasetKinds.length > 0
      ? await db
          .prepare(
            `SELECT collection_date, lender_code, dataset_kind, updated_at, accepted_row_count, written_row_count, completed_detail_count
             FROM lender_dataset_runs
             WHERE lender_code IN (${lenderCodes.map((_, index) => `?${index + 1}`).join(', ')})
               AND dataset_kind IN (${datasetKinds.map((_, index) => `?${lenderCodes.length + index + 1}`).join(', ')})
             ORDER BY updated_at DESC`,
          )
          .bind(...lenderCodes, ...datasetKinds)
          .all<StatusProgressRow>()
      : { results: [] as StatusProgressRow[] }

  function hasNewerScopeProgress(entry: Record<string, unknown>, parsed: ParsedWriteContractLogScope): boolean {
    const entryTs = Date.parse(String(entry.ts || ''))
    if (!Number.isFinite(entryTs)) return false
    for (const row of progressRows.results ?? []) {
      if (row.lender_code !== parsed.lenderCode || row.dataset_kind !== parsed.datasetKind) continue
      if (parsed.collectionDate && row.collection_date !== parsed.collectionDate) continue
      const updatedAt = Date.parse(String(row.updated_at || ''))
      if (!Number.isFinite(updatedAt) || updatedAt <= entryTs) continue
      const hasProgress =
        Number(row.accepted_row_count ?? 0) > 0 ||
        Number(row.written_row_count ?? 0) > 0 ||
        Number(row.completed_detail_count ?? 0) > 0
      if (hasProgress) return true
    }
    return false
  }

  return entries.filter((entry) => {
    if (String(entry.code || '').trim() !== 'write_contract_violation') return true
    const runId = String(entry.run_id || '').trim()
    const lenderCode = String(entry.lender_code || '').trim().toLowerCase()
    if (!runId || !lenderCode) return true
    const scopes = scopesByPair.get(pairKey(runId, lenderCode))
    if (!scopes || scopes.size === 0) return true
    for (const scope of scopes) {
      if (!healthyScopes.has(scope)) return true
    }
    return false
  })
    .filter((entry) => {
      const parsed = parsedScopesByEntry.get(entry)
      if (!parsed) return true
      const scopedKey = parsed.collectionDate
        ? `${parsed.collectionDate}|${parsed.lenderCode}|${parsed.datasetKind}`
        : null
      if (scopedKey && healthyScopesByLenderDataset.has(scopedKey)) return false
      if (hasNewerScopeProgress(entry, parsed)) return false
      return !healthyScopesByLenderDataset.has(`${parsed.lenderCode}|${parsed.datasetKind}`)
    })
}
