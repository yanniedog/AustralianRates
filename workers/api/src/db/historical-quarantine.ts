import type { DatasetKind } from '../../../../packages/shared/src'

type QuarantineDataset = DatasetKind

type DatasetTable = {
  dataset: QuarantineDataset
  table: string
}

type QuarantineReasonCount = {
  reason: string
  count: number
}

export type DatasetQuarantineCounts = {
  dataset: QuarantineDataset
  total: number
  reasons: QuarantineReasonCount[]
}

type QuarantineTargetScope = {
  dataset: QuarantineDataset
  collectionDate: string
  reason: string
  quarantinedAt?: string
}

type QuarantineLenderDayScope = QuarantineTargetScope & {
  bankName: string
}

type QuarantineSeriesScope = QuarantineTargetScope & {
  seriesKey: string
}

type ClearQuarantineScope = {
  dataset?: QuarantineDataset
  collectionDate?: string
  reasonPrefix?: string
}

const DATASET_TABLES: DatasetTable[] = [
  { dataset: 'home_loans', table: 'historical_loan_rates' },
  { dataset: 'savings', table: 'historical_savings_rates' },
  { dataset: 'term_deposits', table: 'historical_term_deposit_rates' },
]

function tableForDataset(dataset: QuarantineDataset): string {
  const entry = DATASET_TABLES.find((item) => item.dataset === dataset)
  if (!entry) {
    throw new Error(`Unsupported quarantine dataset: ${dataset}`)
  }
  return entry.table
}

function normalizedIso(iso?: string): string {
  return String(iso || new Date().toISOString()).slice(0, 19) + 'Z'
}

async function tableHasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return (info.results ?? []).some((row) => row.name === column)
}

export async function quarantineDatasetLenderDay(db: D1Database, input: QuarantineLenderDayScope): Promise<number> {
  const table = tableForDataset(input.dataset)
  const reason = input.reason.trim()
  if (!reason) return 0
  const at = normalizedIso(input.quarantinedAt)
  const hasIsRemoved = await tableHasColumn(db, table, 'is_removed')
  const hasRemovedAt = await tableHasColumn(db, table, 'removed_at')
  const setClauses = ['quarantine_reason = ?1', 'quarantined_at = ?2']
  if (hasIsRemoved) {
    setClauses.push('is_removed = 1')
  }
  if (hasRemovedAt) {
    setClauses.push('removed_at = COALESCE(removed_at, ?2)')
  }
  const activeFilter = hasIsRemoved ? 'AND COALESCE(is_removed, 0) = 0' : ''
  const result = await db
    .prepare(
      `UPDATE ${table}
       SET ${setClauses.join(', ')}
       WHERE collection_date = ?3
         AND bank_name = ?4 ${activeFilter}`,
    )
    .bind(reason, at, input.collectionDate, input.bankName)
    .run()
  return Number(result.meta.changes ?? 0)
}

export async function quarantineDatasetSeriesDate(db: D1Database, input: QuarantineSeriesScope): Promise<number> {
  const table = tableForDataset(input.dataset)
  const reason = input.reason.trim()
  if (!reason) return 0
  const at = normalizedIso(input.quarantinedAt)
  const hasIsRemoved = await tableHasColumn(db, table, 'is_removed')
  const hasRemovedAt = await tableHasColumn(db, table, 'removed_at')
  const setClauses = ['quarantine_reason = ?1', 'quarantined_at = ?2']
  if (hasIsRemoved) {
    setClauses.push('is_removed = 1')
  }
  if (hasRemovedAt) {
    setClauses.push('removed_at = COALESCE(removed_at, ?2)')
  }
  const activeFilter = hasIsRemoved ? 'AND COALESCE(is_removed, 0) = 0' : ''
  const result = await db
    .prepare(
      `UPDATE ${table}
       SET ${setClauses.join(', ')}
       WHERE collection_date = ?3
         AND series_key = ?4 ${activeFilter}`,
    )
    .bind(reason, at, input.collectionDate, input.seriesKey)
    .run()
  return Number(result.meta.changes ?? 0)
}

export async function clearHistoricalQuarantine(db: D1Database, input: ClearQuarantineScope = {}): Promise<number> {
  const targets = input.dataset ? DATASET_TABLES.filter((item) => item.dataset === input.dataset) : DATASET_TABLES
  let total = 0
  for (const target of targets) {
    const hasIsRemoved = await tableHasColumn(db, target.table, 'is_removed')
    const hasRemovedAt = await tableHasColumn(db, target.table, 'removed_at')
    const where: string[] = ['quarantine_reason IS NOT NULL', "TRIM(quarantine_reason) != ''"]
    const binds: Array<string | number> = []
    if (input.collectionDate) {
      where.push('collection_date = ?')
      binds.push(input.collectionDate)
    }
    if (input.reasonPrefix) {
      where.push('quarantine_reason LIKE ?')
      binds.push(`${input.reasonPrefix}%`)
    }
    const setClauses = ['quarantine_reason = NULL', 'quarantined_at = NULL']
    if (hasIsRemoved) {
      setClauses.push('is_removed = 0')
    }
    if (hasRemovedAt) {
      setClauses.push('removed_at = NULL')
    }
    const result = await db
      .prepare(
        `UPDATE ${target.table}
         SET ${setClauses.join(', ')}
         WHERE ${where.join(' AND ')}`,
      )
      .bind(...binds)
      .run()
    total += Number(result.meta.changes ?? 0)
  }
  return total
}

export async function listHistoricalQuarantineCounts(db: D1Database): Promise<DatasetQuarantineCounts[]> {
  const output: DatasetQuarantineCounts[] = []
  for (const target of DATASET_TABLES) {
    const totalRow = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${target.table}
         WHERE quarantine_reason IS NOT NULL
           AND TRIM(quarantine_reason) != ''`,
      )
      .first<{ count: number }>()

    const reasonRows = await db
      .prepare(
        `SELECT quarantine_reason AS reason, COUNT(*) AS count
         FROM ${target.table}
         WHERE quarantine_reason IS NOT NULL
           AND TRIM(quarantine_reason) != ''
         GROUP BY quarantine_reason
         ORDER BY count DESC, quarantine_reason ASC
         LIMIT 20`,
      )
      .all<{ reason: string; count: number }>()

    output.push({
      dataset: target.dataset,
      total: Number(totalRow?.count ?? 0),
      reasons: (reasonRows.results ?? []).map((row) => ({
        reason: String(row.reason ?? ''),
        count: Number(row.count ?? 0),
      })),
    })
  }
  return output
}
