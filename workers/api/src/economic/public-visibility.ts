const ECONOMIC_STALE_DAYS_BY_FREQUENCY: Record<string, number> = {
  daily: 10,
  weekly: 21,
  monthly: 120,
  quarterly: 220,
}

type EconomicVisibilityStatus = {
  last_observation_date: string | null
  status: string
}

function daysBetweenIso(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`)
  const endMs = Date.parse(`${end}T00:00:00.000Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.max(0, Math.floor((endMs - startMs) / 86400000))
}

export function economicSeriesQuarantineStatus(
  status: EconomicVisibilityStatus | undefined,
  frequency: string,
  endDate: string,
): { quarantined: boolean; reason: string | null } {
  if (!status) return { quarantined: true, reason: 'missing_status' }
  if (status.status !== 'ok') return { quarantined: true, reason: `status_${String(status.status || 'unknown')}` }
  if (!status.last_observation_date) return { quarantined: true, reason: 'missing_observation' }
  const maxStaleDays = ECONOMIC_STALE_DAYS_BY_FREQUENCY[frequency] ?? 120
  const staleDays = daysBetweenIso(status.last_observation_date, endDate)
  if (staleDays > maxStaleDays) return { quarantined: true, reason: `stale_${staleDays}d` }
  return { quarantined: false, reason: null }
}

export function shouldExcludeEconomicSeriesFromPublic(
  status: EconomicVisibilityStatus | undefined,
  frequency: string,
  endDate: string,
): boolean {
  if (!status) return false
  return economicSeriesQuarantineStatus(status, frequency, endDate).quarantined
}
