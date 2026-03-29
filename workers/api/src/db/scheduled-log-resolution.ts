import { queryLogs } from '../utils/logger'

function isResolvedScheduledDispatchFailure(entry: Record<string, unknown>, latestSuccessTs: string | null): boolean {
  if (!latestSuccessTs) return false
  const source = String(entry.source || '').trim().toLowerCase()
  const message = String(entry.message || '').trim()
  const ts = String(entry.ts || '').trim()
  if (source !== 'scheduler' || !ts) return false
  if (message !== 'Scheduled run failed' && message !== 'Coverage + site health cron dispatch failed') return false
  return ts < latestSuccessTs
}

async function getLatestScheduledSuccessTs(db: D1Database): Promise<string | null> {
  const { entries } = await queryLogs(db, { source: 'scheduler', limit: 50 })
  let latest: string | null = null
  for (const entry of entries) {
    if (String(entry.level || '').toLowerCase() !== 'info') continue
    if (String(entry.message || '').trim() !== 'Scheduled run completed') continue
    const ts = String(entry.ts || '').trim()
    if (ts && (!latest || ts > latest)) latest = ts
  }
  return latest
}

export async function filterResolvedScheduledDispatchFailureLogEntries(
  db: D1Database,
  entries: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (!entries.length) return entries
  const latestSuccessTs = await getLatestScheduledSuccessTs(db)
  return filterResolvedScheduledDispatchFailureLogEntriesWithLatestSuccessTs(entries, latestSuccessTs)
}

export function filterResolvedScheduledDispatchFailureLogEntriesWithLatestSuccessTs(
  entries: Array<Record<string, unknown>>,
  latestSuccessTs: string | null,
): Array<Record<string, unknown>> {
  if (!latestSuccessTs) return entries
  return entries.filter((entry) => !isResolvedScheduledDispatchFailure(entry, latestSuccessTs))
}
