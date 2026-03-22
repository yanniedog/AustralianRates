import { describe, expect, it } from 'vitest'
import { parseCursorOffset, parsePageSize } from '../src/utils/cursor-pagination'

describe('parsePageSize', () => {
  it('uses fallback when limit param is omitted (empty string)', () => {
    expect(parsePageSize('', 10000, 10000)).toBe(10000)
  })

  it('uses fallback for whitespace-only', () => {
    expect(parsePageSize('   ', 1000, 1000)).toBe(1000)
  })

  it('uses fallback for non-positive numbers', () => {
    expect(parsePageSize('0', 500, 1000)).toBe(500)
    expect(parsePageSize('-3', 500, 1000)).toBe(500)
  })

  it('clamps positive values to max', () => {
    expect(parsePageSize('99999', 50, 100)).toBe(100)
  })

  it('accepts explicit small limits', () => {
    expect(parsePageSize('1', 1000, 1000)).toBe(1)
  })
})

describe('parseCursorOffset', () => {
  it('treats empty as zero offset', () => {
    expect(parseCursorOffset('')).toBe(0)
  })
})
