import { describe, expect, it } from 'vitest'
import {
  parseExcludeCompareEdgeCases,
  parseOptionalPublicMinRate,
  parsePublicMode,
  parseRateOrderBy,
  parseSortDirection,
} from '../src/routes/public-query'

describe('public-query', () => {
  describe('parseExcludeCompareEdgeCases', () => {
    it('defaults to true when omitted or empty', () => {
      expect(parseExcludeCompareEdgeCases(undefined)).toBe(true)
      expect(parseExcludeCompareEdgeCases('')).toBe(true)
    })
    it('accepts truthy tokens', () => {
      expect(parseExcludeCompareEdgeCases('1')).toBe(true)
      expect(parseExcludeCompareEdgeCases('true')).toBe(true)
    })
    it('parses false tokens', () => {
      expect(parseExcludeCompareEdgeCases('0')).toBe(false)
      expect(parseExcludeCompareEdgeCases('false')).toBe(false)
      expect(parseExcludeCompareEdgeCases('off')).toBe(false)
    })
  })

  describe('parseSortDirection', () => {
    it('accepts asc and desc', () => {
      expect(parseSortDirection('asc')).toBe('asc')
      expect(parseSortDirection('desc')).toBe('desc')
    })

    it('falls back on invalid input', () => {
      expect(parseSortDirection(undefined)).toBe('desc')
      expect(parseSortDirection(' sideways ', 'asc')).toBe('asc')
    })
  })

  describe('parseOptionalPublicMinRate', () => {
    it('treats 0.01 as unset when requested', () => {
      expect(
        parseOptionalPublicMinRate('0.01', { treatPointZeroOneAsDefault: true }),
      ).toBeUndefined()
      expect(
        parseOptionalPublicMinRate(' 0.01 ', { treatPointZeroOneAsDefault: true }),
      ).toBeUndefined()
    })

    it('preserves other values and the raw 0.01 when sentinel handling is off', () => {
      expect(parseOptionalPublicMinRate('0.01')).toBe(0.01)
      expect(
        parseOptionalPublicMinRate('0.25', { treatPointZeroOneAsDefault: true }),
      ).toBe(0.25)
    })
  })

  describe('parsePublicMode', () => {
    it('accepts daily and historical modes', () => {
      expect(parsePublicMode('daily')).toBe('daily')
      expect(parsePublicMode(' historical ')).toBe('historical')
    })

    it('defaults to all for empty or invalid input', () => {
      expect(parsePublicMode(undefined)).toBe('all')
      expect(parsePublicMode('anything')).toBe('all')
    })
  })

  describe('parseRateOrderBy', () => {
    it('accepts supported values', () => {
      expect(parseRateOrderBy('rate_asc')).toBe('rate_asc')
      expect(parseRateOrderBy('rate_desc')).toBe('rate_desc')
    })

    it('supports the secondary alias and default fallback', () => {
      expect(parseRateOrderBy(undefined, 'rate_desc')).toBe('rate_desc')
      expect(parseRateOrderBy('default', 'rate_asc')).toBe('default')
      expect(parseRateOrderBy('invalid')).toBe('default')
    })
  })
})
