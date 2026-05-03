import { describe, expect, it } from 'vitest'
import { alignTdImplicitBandEndDateToToday } from '../src/routes/report-plot-route-registration'

describe('report plot route registration', () => {
  it('aligns only implicit term-deposit band windows to today', () => {
    const filters = {
      startDate: '2026-04-02',
      endDate: '2026-05-02',
      chartWindow: '30D' as const,
    }

    expect(alignTdImplicitBandEndDateToToday(filters, 'term_deposits', 'bands', { mode: 'bands' }, '2026-05-03'))
      .toMatchObject({
        startDate: '2026-04-03',
        endDate: '2026-05-03',
      })

    expect(alignTdImplicitBandEndDateToToday(filters, 'savings', 'bands', { mode: 'bands' }, '2026-05-03'))
      .toEqual(filters)

    expect(alignTdImplicitBandEndDateToToday(
      filters,
      'term_deposits',
      'bands',
      { mode: 'bands', end_date: '2026-05-02' },
      '2026-05-03',
    )).toEqual(filters)
  })
})
