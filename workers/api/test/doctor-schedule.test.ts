import { describe, expect, it } from 'vitest'
import {
  isValidIanaTimeZone,
  normalizeDoctorScheduleForPut,
  resolvedDoctorScheduleFromStored,
} from '../src/utils/doctor-schedule'

describe('doctor-schedule', () => {
  it('rejects invalid IANA time zones', () => {
    expect(isValidIanaTimeZone('')).toBe(false)
    expect(isValidIanaTimeZone('Not/A/Zone')).toBe(false)
    expect(isValidIanaTimeZone('Australia/Melbourne')).toBe(true)
    expect(isValidIanaTimeZone('UTC')).toBe(true)
  })

  it('normalizes valid JSON hour and time_zone', () => {
    const n = normalizeDoctorScheduleForPut(JSON.stringify({ hour: 14, time_zone: 'Australia/Sydney' }))
    expect(n.ok).toBe(true)
    if (n.ok) expect(JSON.parse(n.value)).toEqual({ hour: 14, time_zone: 'Australia/Sydney' })
  })

  it('accepts hour as numeric string', () => {
    const n = normalizeDoctorScheduleForPut(JSON.stringify({ hour: '9', time_zone: 'Australia/Perth' }))
    expect(n.ok).toBe(true)
    if (n.ok) expect(JSON.parse(n.value)).toEqual({ hour: 9, time_zone: 'Australia/Perth' })
  })

  it('rejects hour out of range', () => {
    const n = normalizeDoctorScheduleForPut(JSON.stringify({ hour: 24, time_zone: 'UTC' }))
    expect(n.ok).toBe(false)
  })

  it('rejects invalid JSON object shape', () => {
    expect(normalizeDoctorScheduleForPut('[]').ok).toBe(false)
    expect(normalizeDoctorScheduleForPut('not json').ok).toBe(false)
  })

  it('resolvedDoctorScheduleFromStored falls back on empty or bad stored value', () => {
    const r = resolvedDoctorScheduleFromStored(null)
    expect(r.hour).toBe(10)
    expect(r.time_zone).toBe('Australia/Melbourne')
    const r2 = resolvedDoctorScheduleFromStored('{bad')
    expect(r2.hour).toBe(10)
  })
})
