import { DEFAULT_DOCTOR_SCHEDULE_HOUR, MELBOURNE_TIMEZONE } from '../constants'

export type DoctorScheduleResolved = { hour: number; time_zone: string }

export function isValidIanaTimeZone(tz: string): boolean {
  const t = String(tz || '').trim()
  if (t.length < 3 || t.length > 80) return false
  if (!/^[A-Za-z0-9_/+\-]+$/.test(t)) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: t }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function normalizeDoctorScheduleForPut(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  let j: unknown
  try {
    j = JSON.parse(String(raw ?? '').trim())
  } catch {
    return { ok: false, error: 'doctor_schedule must be valid JSON.' }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return { ok: false, error: 'doctor_schedule must be a JSON object.' }
  }
  const o = j as { hour?: unknown; time_zone?: unknown }
  const hourRaw = o.hour
  const time_zone = String(o.time_zone ?? '').trim()
  let h: number
  if (typeof hourRaw === 'number' && Number.isFinite(hourRaw)) {
    h = Math.trunc(hourRaw)
  } else if (typeof hourRaw === 'string' && /^-?\d+$/.test(hourRaw.trim())) {
    h = Number.parseInt(hourRaw.trim(), 10)
  } else {
    return { ok: false, error: 'doctor_schedule.hour must be an integer 0–23.' }
  }
  if (!Number.isFinite(h) || h < 0 || h > 23) {
    return { ok: false, error: 'doctor_schedule.hour must be an integer 0–23.' }
  }
  if (!isValidIanaTimeZone(time_zone)) {
    return { ok: false, error: 'doctor_schedule.time_zone must be a valid IANA time zone name.' }
  }
  return { ok: true, value: JSON.stringify({ hour: h, time_zone }) }
}

export function resolvedDoctorScheduleFromStored(value: string | null): DoctorScheduleResolved {
  if (value == null || String(value).trim() === '') {
    return { hour: DEFAULT_DOCTOR_SCHEDULE_HOUR, time_zone: MELBOURNE_TIMEZONE }
  }
  const n = normalizeDoctorScheduleForPut(String(value).trim())
  if (!n.ok) {
    return { hour: DEFAULT_DOCTOR_SCHEDULE_HOUR, time_zone: MELBOURNE_TIMEZONE }
  }
  try {
    return JSON.parse(n.value) as DoctorScheduleResolved
  } catch {
    return { hour: DEFAULT_DOCTOR_SCHEDULE_HOUR, time_zone: MELBOURNE_TIMEZONE }
  }
}
