import { describe, expect, it } from 'vitest'

import { summarizeSlicePairStatsRow } from '../src/db/slice-pair-stats'

describe('slice pair stats summarize', () => {
  it('marks checksum_ok when six buckets equal universe_total', () => {
    const raw = {
      universe_total: 100,
      up_count: 10,
      flat_count: 20,
      down_count: 30,
      prev_missing_count: 5,
      curr_missing_count: 5,
      both_missing_count: 30,
    }
    const out = summarizeSlicePairStatsRow(raw)
    expect(out.checksum_ok).toBe(true)
    expect(out.universe_total).toBe(100)
  })

  it('marks checksum_ok false when counts do not sum', () => {
    const out = summarizeSlicePairStatsRow({
      universe_total: 10,
      up_count: 1,
      flat_count: 1,
      down_count: 1,
      prev_missing_count: 1,
      curr_missing_count: 1,
      both_missing_count: 1,
    })
    expect(out.checksum_ok).toBe(false)
  })
})
