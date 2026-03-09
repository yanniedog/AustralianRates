import { describe, expect, it } from 'vitest'
import { cdrProductEndpointUrlFromSourceUrl } from '../src/db/active-cdr-products'

describe('cdrProductEndpointUrlFromSourceUrl', () => {
  it('derives the products endpoint from a real CDR detail URL', () => {
    const endpointUrl = cdrProductEndpointUrlFromSourceUrl(
      'https://api.commbank.com.au/public/cds-au/v1/banking/products/f889dd909d1d44858a2f2ad839dcda89',
    )
    expect(endpointUrl).toBe('https://api.commbank.com.au/public/cds-au/v1/banking/products')
  })

  it('returns null for non-CDR source URLs', () => {
    const endpointUrl = cdrProductEndpointUrlFromSourceUrl(
      'https://www.commbank.com.au/business/banking-and-cards/bank-accounts/farm-management-account.html',
    )
    expect(endpointUrl).toBeNull()
  })
})
