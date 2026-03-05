import { describe, expect, it } from 'vitest'
import { pendingSavingsTdLenders } from '../src/pipeline/bootstrap-jobs'
import type { LenderConfig } from '../src/types'

function lender(code: string): LenderConfig {
  return {
    code,
    name: code.toUpperCase(),
    canonical_bank_name: code.toUpperCase(),
    register_brand_name: code.toUpperCase(),
    seed_rate_urls: [],
  }
}

describe('daily pending savings/term-deposit lender selection', () => {
  it('keeps a lender pending when either savings or term deposits is stale', () => {
    const lenders = [lender('alpha'), lender('beta'), lender('gamma')]
    const completedSavings = new Set(['alpha', 'beta'])
    const completedTd = new Set(['alpha', 'gamma'])

    const pending = pendingSavingsTdLenders(lenders, completedSavings, completedTd)

    expect(pending.map((item) => item.code)).toEqual(['beta', 'gamma'])
  })
})
