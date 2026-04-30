import { describe, expect, it } from 'vitest'
import {
  inferCdrDataset,
  parseCdrProductCategoryFromJson,
} from '../src/ingest/cdr/product-classification'

describe('cdr product classification', () => {
  it('classifies home-loan products from residential mortgage category', () => {
    const dataset = inferCdrDataset(
      {
        productCategory: 'RESIDENTIAL_MORTGAGES',
        name: 'ANZ Simplicity PLUS',
      },
      { allowNameFallback: false },
    )
    expect(dataset).toBe('home_loans')
  })

  it('classifies savings products from transaction and savings category aliases', () => {
    const dataset = inferCdrDataset(
      {
        productCategory: 'transaction-and-savings-accounts',
        name: 'Westpac Choice',
      },
      { allowNameFallback: false },
    )
    expect(dataset).toBe('savings')
  })

  it('classifies term-deposit products from fixed term deposit category aliases', () => {
    const dataset = inferCdrDataset(
      {
        productCategory: 'fixed term deposits',
        name: 'Business Investment Account',
      },
      { allowNameFallback: false },
    )
    expect(dataset).toBe('term_deposits')
  })

  it('parses category from both root and nested cdr detail payloads', () => {
    const nested = parseCdrProductCategoryFromJson(
      JSON.stringify({
        data: {
          productCategory: 'RESIDENTIAL_MORTGAGES',
        },
      }),
    )
    const root = parseCdrProductCategoryFromJson(
      JSON.stringify({
        category: 'TERM_DEPOSITS',
      }),
    )
    expect(nested).toBe('RESIDENTIAL_MORTGAGES')
    expect(root).toBe('TERM_DEPOSITS')
  })
})
