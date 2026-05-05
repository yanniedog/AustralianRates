import { describe, expect, it } from 'vitest'
import { defaultDateRangeFromCollectionBounds } from '../src/db/scope-filters'

describe('default scope filter date range', () => {
  it('ends at the latest real collection date rather than today', () => {
    expect(defaultDateRangeFromCollectionBounds('2025-01-01', '2026-05-02')).toEqual({
      startDate: '2025-05-02',
      endDate: '2026-05-02',
    })
  })

  it('prefers the section latest collection date over a newer raw historical bound', () => {
    expect(defaultDateRangeFromCollectionBounds('2025-01-01', '2026-05-05', '2026-05-02')).toEqual({
      startDate: '2025-05-02',
      endDate: '2026-05-02',
    })
  })

  it('clips the start date to the dataset minimum when the dataset is newer than the lookback window', () => {
    expect(defaultDateRangeFromCollectionBounds('2026-04-20', '2026-05-02')).toEqual({
      startDate: '2026-04-20',
      endDate: '2026-05-02',
    })
  })
})
