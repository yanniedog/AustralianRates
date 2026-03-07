import { describe, expect, it } from 'vitest'
import {
  baseProductsSourceUrl,
  parseLegacyRawPayloadLenderCode,
  pickPreferredExistingListFetchEvent,
  pickPreferredRawPayloadListRow,
} from '../src/pipeline/lineage-repair-base-url'

describe('lineage repair base-url helpers', () => {
  it('derives the product list url from encoded detail urls', () => {
    expect(
      baseProductsSourceUrl('https://public.ob.hsbc.com.au/cds-au/v1/banking/products/HOME%20SMART%20RR'),
    ).toBe('https://public.ob.hsbc.com.au/cds-au/v1/banking/products')

    expect(
      baseProductsSourceUrl('https://id-ob.suncorpbank.com.au/cds-au/v1/banking/products/BTB150k%2B'),
    ).toBe('https://id-ob.suncorpbank.com.au/cds-au/v1/banking/products')
  })

  it('extracts lender codes from legacy raw payload notes', () => {
    expect(parseLegacyRawPayloadLenderCode('daily_product_index lender=bankofmelbourne')).toBe('bankofmelbourne')
    expect(parseLegacyRawPayloadLenderCode('cdr_collection products=67 rows=56')).toBeNull()
  })

  it('prefers a successful savings list fetch as the fallback for term deposits', () => {
    const chosen = pickPreferredExistingListFetchEvent(
      [
        {
          id: 1,
          run_id: 'daily:2026-03-04:2026-03-03T13:05:55.000Z',
          dataset_kind: 'term_deposits',
          source_url: 'https://digital-api.bankofmelbourne.com.au/cds-au/v1/banking/products',
          fetched_at: '2026-03-03T13:11:13.676Z',
          http_status: 202,
        },
        {
          id: 2,
          run_id: 'daily:2026-03-04:2026-03-03T13:05:55.000Z',
          dataset_kind: 'savings',
          source_url: 'https://digital-api.bankofmelbourne.com.au/cds-au/v1/banking/products',
          fetched_at: '2026-03-03T13:11:11.990Z',
          http_status: 200,
        },
      ],
      'term_deposits',
    )

    expect(chosen?.id).toBe(2)
  })

  it('prefers dataset-appropriate list payload notes over a generic collection', () => {
    const chosen = pickPreferredRawPayloadListRow(
      [
        {
          id: 10,
          source_type: 'cdr_products',
          source_url: 'https://od1.open-banking.business.greatsouthernbank.com.au/api/cds-au/v1/banking/products',
          fetched_at: '2026-02-27T00:11:16.612Z',
          content_hash: 'hash-generic',
          r2_key: 'raw/cdr_products/2026/02/27/hash-generic.json',
          http_status: 200,
          notes: 'cdr_collection products=50 rows=10',
          body_bytes: 123,
          content_type: 'application/json; charset=utf-8',
        },
        {
          id: 11,
          source_type: 'cdr_products',
          source_url: 'https://od1.open-banking.business.greatsouthernbank.com.au/api/cds-au/v1/banking/products',
          fetched_at: '2026-02-27T00:11:30.748Z',
          content_hash: 'hash-savings-td',
          r2_key: 'raw/cdr_products/2026/02/27/hash-savings-td.json',
          http_status: 200,
          notes: 'savings_td_product_index lender=great_southern',
          body_bytes: 123,
          content_type: 'application/json; charset=utf-8',
        },
      ],
      '2026-02-27T00:20:46Z',
      'term_deposits',
    )

    expect(chosen?.id).toBe(11)
  })
})
