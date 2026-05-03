import { describe, expect, it } from 'vitest'
import {
  planSavingsTdEnqueueDatasetsForEmptyPending,
  type DailyDatasetSelection,
} from '../src/pipeline/bootstrap-jobs'

function sel(partial: Partial<DailyDatasetSelection>): DailyDatasetSelection {
  return {
    homeLoans: partial.homeLoans ?? false,
    savings: partial.savings ?? false,
    termDeposits: partial.termDeposits ?? false,
  }
}

describe('planSavingsTdEnqueueDatasetsForEmptyPending', () => {
  it('forces repick with term_deposits only when savings has rows but TD is empty', () => {
    const plan = planSavingsTdEnqueueDatasetsForEmptyPending({
      selection: sel({ savings: true, termDeposits: true }),
      historicalSavingsCount: 100,
      historicalTdCount: 0,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(true)
    expect(plan.datasets).toEqual(['term_deposits'])
  })

  it('does not repick when both tables have rows', () => {
    const plan = planSavingsTdEnqueueDatasetsForEmptyPending({
      selection: sel({ savings: true, termDeposits: true }),
      historicalSavingsCount: 50,
      historicalTdCount: 80,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(false)
    expect(plan.datasets).toEqual(['savings', 'term_deposits'])
  })

  it('repicks savings only when TD is not selected and savings is empty', () => {
    const plan = planSavingsTdEnqueueDatasetsForEmptyPending({
      selection: sel({ savings: true, termDeposits: false }),
      historicalSavingsCount: 0,
      historicalTdCount: 999,
    })
    expect(plan.repickAllSavingsLendersWithForce).toBe(true)
    expect(plan.datasets).toEqual(['savings'])
  })
})
