import { describe, expect, it } from 'vitest'
import { parseWriteContractViolationLogScope } from '../src/db/write-contract-violation-resolution'

describe('parseWriteContractViolationLogScope', () => {
  it('parses home-loan write-contract logs that only expose bank name in the message', () => {
    expect(
      parseWriteContractViolationLogScope({
        code: 'write_contract_violation',
        lender_code: 'Westpac Banking Corporation',
        message: 'upsert_failed product=HLVariableOffsetInvestment bank=Westpac Banking Corporation date=2026-03-29',
      }),
    ).toEqual({
      lenderCode: 'westpac',
      datasetKind: 'home_loans',
      collectionDate: '2026-03-29',
    })
  })

  it('parses savings write-contract logs without an embedded collection date', () => {
    expect(
      parseWriteContractViolationLogScope({
        code: 'write_contract_violation',
        lender_code: 'Great Southern Bank',
        message: 'savings_upsert_failed product=956c0e95-5302-47cc-a084-d7970eafee85 bank=Great Southern Bank',
      }),
    ).toEqual({
      lenderCode: 'great_southern',
      datasetKind: 'savings',
      collectionDate: null,
    })
  })
})
