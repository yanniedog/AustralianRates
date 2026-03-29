import { describe, expect, it } from 'vitest'
import {
  addDatasetModeWhere,
  addSingleColumnRateBoundsWhere,
} from '../src/db/query-common'

describe('query-common', () => {
  describe('addSingleColumnRateBoundsWhere', () => {
    it('adds no clauses for empty bounds', () => {
      const where: string[] = []
      const binds: Array<string | number> = []

      addSingleColumnRateBoundsWhere(where, binds, 't.interest_rate')

      expect(where).toEqual([])
      expect(binds).toEqual([])
    })

    it('adds min and max rate clauses in order', () => {
      const where: string[] = []
      const binds: Array<string | number> = []

      addSingleColumnRateBoundsWhere(where, binds, 't.interest_rate', 4.1, 5.2)

      expect(where).toEqual(['t.interest_rate >= ?', 't.interest_rate <= ?'])
      expect(binds).toEqual([4.1, 5.2])
    })
  })

  describe('addDatasetModeWhere', () => {
    it('defaults to all-mode confidence filtering', () => {
      const where: string[] = []
      const binds: Array<string | number> = []

      addDatasetModeWhere(where, binds, 'h.retrieval_type', 'h.confidence_score', undefined, 0.85, 0.65)

      expect(where).toEqual(['h.confidence_score >= ?'])
      expect(binds).toEqual([0.85])
    })

    it('adds daily mode clauses in order', () => {
      const where: string[] = []
      const binds: Array<string | number> = []

      addDatasetModeWhere(where, binds, 'h.retrieval_type', 'h.confidence_score', 'daily', 0.85, 0.65)

      expect(where).toEqual(["h.retrieval_type != 'historical_scrape'", 'h.confidence_score >= ?'])
      expect(binds).toEqual([0.85])
    })

    it('adds historical mode clauses in order', () => {
      const where: string[] = []
      const binds: Array<string | number> = []

      addDatasetModeWhere(where, binds, 'h.retrieval_type', 'h.confidence_score', 'historical', 0.85, 0.65)

      expect(where).toEqual(["h.retrieval_type = 'historical_scrape'", 'h.confidence_score >= ?'])
      expect(binds).toEqual([0.65])
    })
  })
})
