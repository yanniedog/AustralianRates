import { describe, expect, it } from 'vitest'
import { planSavingsTdEnqueueDatasets, type DailyDatasetSelection } from '../src/pipeline/bootstrap-jobs'

function sel(partial: Partial<DailyDatasetSelection>): DailyDatasetSelection {
  return {
    homeLoans: partial.homeLoans ?? false,
    savings: partial.savings ?? false,
    termDeposits: partial.termDeposits ?? false,
  }
}

describe('planSavingsTdEnqueueDatasets', () => {
  it('returns full datasets when lenders are already pending', () => {
    const plan = planSavingsTdEnqueueDatasets({
      selection: sel({ savings: true, termDeposits: true }),
      pendingSavingsLendersCount: 3,
      historicalSavingsCount: 0,
      historicalTdCount: 0,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(false)
    expect(plan.datasets).toEqual(['savings', 'term_deposits'])
  })

  it('forces repick with term_deposits only when savings has rows but TD is empty', () => {
    const plan = planSavingsTdEnqueueDatasets({
      selection: sel({ savings: true, termDeposits: true }),
      pendingSavingsLendersCount: 0,
      historicalSavingsCount: 100,
      historicalTdCount: 0,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(true)
    expect(plan.datasets).toEqual(['term_deposits'])
  })

  it('does not repick when both tables have rows', () => {
    const plan = planSavingsTdEnqueueDatasets({
      selection: sel({ savings: true, termDeposits: true }),
      pendingSavingsLendersCount: 0,
      historicalSavingsCount: 50,
      historicalTdCount: 80,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(false)
    expect(plan.datasets).toEqual(['savings', 'term_deposits'])
  })

  it('repicks savings only when TD is not selected and savings is empty', () => {
    const plan = planSavingsTdEnqueueDatasets({
      selection: sel({ savings: true, termDeposits: false }),
      pendingSavingsLendersCount: 0,
      historicalSavingsCount: 0,
      historicalTdCount: 999,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(true)
    expect(plan.datasets).toEqual(['savings'])
  })
})
