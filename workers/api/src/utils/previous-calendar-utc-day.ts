/** Calendar previous day in UTC, matching SQLite `date(D, '-1 day')` for YYYY-MM-DD. */
export function previousCalendarUtcDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid_calendar_day:${ymd}`)
  }
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
