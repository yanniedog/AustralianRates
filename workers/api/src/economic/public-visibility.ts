import type { EconomicStatusRow } from '../db/economic-series'

const ECONOMIC_STALE_DAYS_BY_FREQUENCY: Record<string, number> = {
  daily: 10,
  weekly: 21,
  monthly: 120,
  quarterly: 220,
}

export type EconomicVisibilityStatus = Pick<EconomicStatusRow, 'last_observation_date' | 'status'>

export type EconomicVisibilityContext = {
  endDate: string
  endMs: number
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createEconomicVisibilityContext(endDate = todayIso()): EconomicVisibilityContext {
  return {
    endDate,
    endMs: Date.parse(`${endDate}T00:00:00.000Z`),
  }
}

function daysBetweenIso(start: string, context: EconomicVisibilityContext): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(context.endMs)) return 0
  return Math.max(0, Math.floor((context.endMs - startMs) / 86400000))
}

export function economicSeriesQuarantineStatus(
  status: EconomicVisibilityStatus | undefined,
  frequency: string,
  context: EconomicVisibilityContext,
): { quarantined: boolean; reason: string | null } {
  if (!status) return { quarantined: true, reason: 'missing_status' }
  if (status.status !== 'ok') return { quarantined: true, reason: `status_${String(status.status || 'unknown')}` }
  if (!status.last_observation_date) return { quarantined: true, reason: 'missing_observation' }
  const maxStaleDays = ECONOMIC_STALE_DAYS_BY_FREQUENCY[frequency] ?? 120
  const staleDays = daysBetweenIso(status.last_observation_date, context)
  if (staleDays > maxStaleDays) return { quarantined: true, reason: `stale_${staleDays}d` }
  return { quarantined: false, reason: null }
}

export function shouldExcludeEconomicSeriesFromPublic(
  status: EconomicVisibilityStatus | undefined,
  frequency: string,
  context: EconomicVisibilityContext,
): boolean {
  if (!status) return false
  return economicSeriesQuarantineStatus(status, frequency, context).quarantined
}
