import { describe, expect, it } from 'vitest'
import {
  isAllowedDataQualityFlag,
  isFiniteNumber,
  isValidCollectionDate,
  isValidUrl,
  reasonableStringLength,
  VALIDATE_COMMON,
} from '../src/ingest/validate-common'

describe('validate-common', () => {
  describe('isValidCollectionDate', () => {
    it('accepts YYYY-MM-DD in range', () => {
      expect(isValidCollectionDate('2025-02-20')).toBe(true)
      expect(isValidCollectionDate('1990-01-01')).toBe(true)
    })
    it('rejects invalid format', () => {
      expect(isValidCollectionDate('')).toBe(false)
      expect(isValidCollectionDate('20-02-2025')).toBe(false)
      expect(isValidCollectionDate('2025/02/20')).toBe(false)
    })
    it('rejects date before 1990', () => {
      expect(isValidCollectionDate('1989-12-31')).toBe(false)
    })
  })

  describe('isValidUrl', () => {
    it('accepts http and https URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true)
      expect(isValidUrl('http://example.com/path')).toBe(true)
    })
    it('rejects non-URLs', () => {
      expect(isValidUrl('')).toBe(false)
      expect(isValidUrl('not-a-url')).toBe(false)
      expect(isValidUrl('ftp://example.com')).toBe(false)
    })
  })

  describe('isFiniteNumber', () => {
    it('accepts finite numbers', () => {
      expect(isFiniteNumber(0)).toBe(true)
      expect(isFiniteNumber(5.99)).toBe(true)
    })
    it('rejects NaN and Infinity', () => {
      expect(isFiniteNumber(NaN)).toBe(false)
      expect(isFiniteNumber(Infinity)).toBe(false)
      expect(isFiniteNumber(-Infinity)).toBe(false)
    })
  })

  describe('isAllowedDataQualityFlag', () => {
    it('accepts known flags', () => {
      expect(isAllowedDataQualityFlag('cdr_live', ['cdr_live', 'ok'])).toBe(true)
      expect(isAllowedDataQualityFlag('parsed_from_wayback_cdr', ['parsed_from_wayback_cdr'])).toBe(true)
    })
    it('rejects unknown flags', () => {
      expect(isAllowedDataQualityFlag('unknown', ['cdr_live'])).toBe(false)
    })
  })

  describe('reasonableStringLength', () => {
    it('accepts string within length and without control chars', () => {
      expect(reasonableStringLength('ANZ', VALIDATE_COMMON.MAX_BANK_NAME_LENGTH)).toBe(true)
    })
    it('rejects empty or over max', () => {
      expect(reasonableStringLength('', 100)).toBe(false)
      expect(reasonableStringLength('x'.repeat(201), 200)).toBe(false)
    })
  })
})
