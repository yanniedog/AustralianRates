import { describe, expect, it } from 'vitest'
import { parseExcludeCompareEdgeCases } from '../src/routes/public-query'

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
})
