import { describe, expect, it } from 'vitest'
import { buildSnapshotCurrentLeaders } from '../src/routes/snapshot-current-leaders'
import { stripConsumerPresetFilters } from '../src/db/scope-filters'
import type { ScopedFilters } from '../src/db/scope-filters'

describe('buildSnapshotCurrentLeaders', () => {
  const consumerDefaultRow = {
    bank_name: 'ANZ',
    product_name: 'Basic Variable',
    interest_rate: 5.49,
    security_purpose: 'owner_occupied',
    repayment_type: 'principal_and_interest',
    rate_structure: 'variable',
    lvr_tier: 'lvr_80-85%',
  }

  const investmentRow = {
    bank_name: 'CBA',
    product_name: 'Invest Variable',
    interest_rate: 5.99,
    security_purpose: 'investment',
    repayment_type: 'principal_and_interest',
    rate_structure: 'variable',
    lvr_tier: 'lvr_80-85%',
  }

  const fixedRow = {
    bank_name: 'Westpac',
    product_name: 'Fixed 1y',
    interest_rate: 5.79,
    security_purpose: 'owner_occupied',
    repayment_type: 'principal_and_interest',
    rate_structure: 'fixed_1yr',
    lvr_tier: 'lvr_80-85%',
  }

  it('returns only one scenario when rows are consumer-default scoped', () => {
    const leaders = buildSnapshotCurrentLeaders('home_loans', [consumerDefaultRow])
    expect(leaders.scenarios).toHaveLength(1)
    expect((leaders.scenarios as Array<{ scenarioLabel?: string }>)[0]?.scenarioLabel).toBe(
      'OO P&I variable 80-85%',
    )
  })

  it('returns all mortgage scenarios when rows span LVR tiers and rate types', () => {
    const rows = [
      consumerDefaultRow,
      {
        ...consumerDefaultRow,
        lvr_tier: 'lvr_70-80%',
        interest_rate: 5.39,
      },
      {
        ...consumerDefaultRow,
        lvr_tier: 'lvr_60-70%',
        interest_rate: 5.29,
      },
      {
        ...consumerDefaultRow,
        lvr_tier: 'lvr_=60%',
        interest_rate: 5.19,
      },
      {
        ...consumerDefaultRow,
        lvr_tier: 'lvr_85-90%',
        interest_rate: 5.59,
      },
      {
        ...consumerDefaultRow,
        lvr_tier: 'lvr_90-95%',
        interest_rate: 5.69,
      },
      fixedRow,
      investmentRow,
    ]
    const leaders = buildSnapshotCurrentLeaders('home_loans', rows)
    expect(leaders.scenarios).toHaveLength(8)
  })
})

describe('stripConsumerPresetFilters', () => {
  it('removes consumer-default home-loan preset fields for leader queries', () => {
    const scoped: ScopedFilters = {
      startDate: '2026-01-01',
      endDate: '2026-06-28',
      mode: 'all',
      includeRemoved: false,
      sourceMode: 'all',
      securityPurpose: 'owner_occupied',
      repaymentType: 'principal_and_interest',
      rateStructure: 'variable',
      lvrTier: 'lvr_80-85%',
      minRate: 0.01,
    }
    const unscoped = stripConsumerPresetFilters('home_loans', scoped)
    expect(unscoped).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-06-28',
      mode: 'all',
      includeRemoved: false,
      sourceMode: 'all',
    })
  })
})
