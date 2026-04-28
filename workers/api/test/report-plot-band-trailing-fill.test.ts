import { describe, expect, it } from 'vitest'
import { forwardFillReportBandSeriesToWindowEnd } from '../src/db/report-plot'

describe('forwardFillReportBandSeriesToWindowEnd', () => {
  it('replicates trailing band rates through resolved window end', () => {
    const input = [
      {
        bank_name: 'Example Bank',
        color_key: 'example bank',
        points: [
          { date: '2026-04-25', min_rate: 5, max_rate: 6, mean_rate: 5.5 },
          { date: '2026-04-26', min_rate: 5, max_rate: 6, mean_rate: 5.5 },
        ],
      },
    ]
    const out = forwardFillReportBandSeriesToWindowEnd(input, '2026-04-28')
    expect(out[0].points.map((p) => p.date)).toEqual([
      '2026-04-25',
      '2026-04-26',
      '2026-04-27',
      '2026-04-28',
    ])
    expect(out[0].points[3]).toEqual({
      date: '2026-04-28',
      min_rate: 5,
      max_rate: 6,
      mean_rate: 5.5,
    })
  })

  it('no-ops when last point already reaches window end', () => {
    const input = [
      {
        bank_name: 'B',
        color_key: 'b',
        points: [{ date: '2026-04-28', min_rate: 1, max_rate: 2, mean_rate: 1.5 }],
      },
    ]
    const out = forwardFillReportBandSeriesToWindowEnd(input, '2026-04-28')
    expect(out).toEqual(input)
  })

  it('no-ops when window end is missing', () => {
    const input = [
      {
        bank_name: 'C',
        color_key: 'c',
        points: [{ date: '2026-01-01', min_rate: 3, max_rate: 4, mean_rate: 3.5 }],
      },
    ]
    expect(forwardFillReportBandSeriesToWindowEnd(input, undefined)).toEqual(input)
  })
})
