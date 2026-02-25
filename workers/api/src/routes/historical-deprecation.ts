export const HISTORICAL_TRIGGER_DEPRECATION_CODE = 'HISTORICAL_TRIGGER_RANGE_DEPRECATED'
export const HISTORICAL_TRIGGER_DEPRECATION_MESSAGE =
  'Historical range payloads on trigger-run are deprecated. Hourly server-side Wayback backfill now runs automatically.'

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export function hasDeprecatedHistoricalTriggerPayload(body: Record<string, unknown>): boolean {
  if (!body || typeof body !== 'object') return false
  if (hasOwn(body, 'historical') || hasOwn(body, 'include_historical') || hasOwn(body, 'historical_pull')) {
    return true
  }
  if (hasOwn(body, 'start_date') || hasOwn(body, 'end_date') || hasOwn(body, 'startDate') || hasOwn(body, 'endDate')) {
    return true
  }
  return false
}
