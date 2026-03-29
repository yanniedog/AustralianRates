type NumberRow = { n: number | null }
type HistoricalTaskRow = {
  task_id: number | null
  status: string | null
  last_error: string | null
}

function normalizeCode(entry: Record<string, unknown>): string {
  return String(entry.code ?? '').trim()
}

function normalizeMessage(entry: Record<string, unknown>): string {
  return String(entry.message ?? '').trim()
}

function isHistoricalTaskFailure(entry: Record<string, unknown>): boolean {
  return normalizeCode(entry) === 'historical_task_execute_failed' || normalizeMessage(entry) === 'historical_task_execute failed'
}

export function parseHistoricalTaskIdFromLogEntry(entry: Record<string, unknown>): number | null {
  if (!isHistoricalTaskFailure(entry)) return null
  const context = typeof entry.context === 'string' ? entry.context : JSON.stringify(entry.context ?? '')
  const match = /task_id=(\d+)/i.exec(context)
  if (!match) return null
  const taskId = Number(match[1])
  return Number.isFinite(taskId) ? taskId : null
}

function isResolvedHistoricalTaskRow(row: HistoricalTaskRow): boolean {
  return Number.isFinite(Number(row.task_id)) && String(row.status ?? '').trim() === 'completed' && !String(row.last_error ?? '').trim()
}

export function filterResolvedHistoricalTaskFailureLogEntriesWithResolvedTaskIds(
  entries: Array<Record<string, unknown>>,
  resolvedTaskIds: Set<number>,
): Array<Record<string, unknown>> {
  if (resolvedTaskIds.size === 0) return entries
  return entries.filter((entry) => {
    const taskId = parseHistoricalTaskIdFromLogEntry(entry)
    return taskId == null || !resolvedTaskIds.has(taskId)
  })
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

export async function filterResolvedHistoricalTaskFailureLogEntries(
  db: D1Database,
  entries: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const taskIds = Array.from(
    new Set(
      entries
        .map((entry) => parseHistoricalTaskIdFromLogEntry(entry))
        .filter((taskId): taskId is number => Number.isFinite(taskId)),
    ),
  )
  if (taskIds.length === 0) return entries
  if (!(await tableExists(db, 'client_historical_tasks'))) return entries

  const rows = await db
    .prepare(
      `SELECT task_id, status, last_error
       FROM client_historical_tasks
       WHERE task_id IN (${taskIds.map((_, index) => `?${index + 1}`).join(', ')})`,
    )
    .bind(...taskIds)
    .all<HistoricalTaskRow>()

  const resolvedTaskIds = new Set(
    (rows.results ?? [])
      .filter((row) => isResolvedHistoricalTaskRow(row))
      .map((row) => Number(row.task_id)),
  )
  return filterResolvedHistoricalTaskFailureLogEntriesWithResolvedTaskIds(entries, resolvedTaskIds)
}
