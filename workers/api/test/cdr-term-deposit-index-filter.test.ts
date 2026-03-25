import { describe, expect, it } from 'vitest'
import {
  excludeMacquarieBusinessTermDepositProductId,
  includeTermDepositIndexProduct,
} from '../src/ingest/cdr-savings'

describe('includeTermDepositIndexProduct', () => {
  it('includes Macquarie retail term deposit', () => {
    expect(
      includeTermDepositIndexProduct(
        {
          productCategory: 'TERM_DEPOSITS',
          productId: 'TD001MBLTDA001',
          name: 'Macquarie Term Deposit',
        },
        'macquarie',
      ),
    ).toBe(true)
  })

  it('excludes Macquarie business banking term deposit (no rates in CDR detail)', () => {
    expect(
      includeTermDepositIndexProduct(
        {
          productCategory: 'TERM_DEPOSITS',
          productId: 'BB001MBLTDA001',
          name: 'Macquarie Business Banking Term Deposit',
        },
        'macquarie',
      ),
    ).toBe(false)
  })

  it('flags Macquarie business TD product id for supplement skip', () => {
    expect(excludeMacquarieBusinessTermDepositProductId('BB001MBLTDA001')).toBe(true)
    expect(excludeMacquarieBusinessTermDepositProductId('TD001MBLTDA001')).toBe(false)
  })

  it('does not exclude other lenders when name mentions business', () => {
    expect(
      includeTermDepositIndexProduct(
        {
          productCategory: 'TERM_DEPOSITS',
          productId: 'X1',
          name: 'Business Term Deposit',
        },
        'nab',
      ),
    ).toBe(true)
  })
})
