import { describe, expect, it } from 'vitest'
import { parseCsvLines } from '../src/ingest/rba'

describe('RBA CSV parser', () => {
  it('ignores non-finite and non-positive cash rates', () => {
    const csv = [
      'Date,Cash Rate Target',
      '03-Mar-2026,3.85',
      '04-Mar-2026,0',
      '05-Mar-2026,-0.10',
      '06-Mar-2026,NaN',
    ].join('\n')

    const points = parseCsvLines(csv)

    expect(points).toEqual([
      {
        date: '2026-03-03',
        cashRate: 3.85,
      },
    ])
  })
})
