import { describe, expect, it } from 'vitest'
import { brandMatchScore, selectBestMatchingBrand, type RegisterBrand } from '../src/ingest/cdr/discovery'
import { candidateProductEndpoints } from '../src/ingest/product-endpoints'
import type { LenderConfig } from '../src/types'

function lender(overrides?: Partial<LenderConfig>): LenderConfig {
  return {
    code: 'ing',
    name: 'ING',
    canonical_bank_name: 'ING',
    register_brand_name: 'ING',
    products_endpoint: 'https://id.ob.ing.com.au/cds-au/v1/banking/products',
    seed_rate_urls: [],
    ...overrides,
  }
}

describe('CDR discovery brand matching', () => {
  it('does not match substring-only token collisions (ING vs banking)', () => {
    const ing = lender()
    const unrelated: RegisterBrand = {
      brandName: 'Banking Services',
      legalEntityName: 'Australian Banking Group Pty Ltd',
      endpointUrl: 'https://public.ob.business.hsbc.com.au/cds-au/v1/banking/products',
    }
    const direct: RegisterBrand = {
      brandName: 'ING',
      legalEntityName: 'ING Bank (Australia) Limited',
      endpointUrl: 'https://id.ob.ing.com.au/cds-au/v1/banking/products',
    }

    expect(brandMatchScore(ing, unrelated)).toBe(0)
    expect(brandMatchScore(ing, direct)).toBeGreaterThan(0)
    expect(selectBestMatchingBrand(ing, [unrelated, direct])?.endpointUrl).toBe(direct.endpointUrl)
  })

  it('prefers register hits on the configured endpoint host when multiple brands match', () => {
    const cba = lender({
      code: 'cba',
      name: 'CBA',
      canonical_bank_name: 'Commonwealth Bank of Australia',
      register_brand_name: 'Commonwealth Bank of Australia',
      products_endpoint: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
    })
    const brands: RegisterBrand[] = [
      {
        brandName: 'Commonwealth Bank of Australia',
        legalEntityName: 'Commonwealth Bank of Australia',
        endpointUrl: 'https://cdr.commbiz.api.commbank.com.au/cbzpublic/cds-au/v1/banking/products',
      },
      {
        brandName: 'Commonwealth Bank of Australia',
        legalEntityName: 'Commonwealth Bank of Australia',
        endpointUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
      },
    ]

    const selected = selectBestMatchingBrand(cba, brands)
    expect(selected?.endpointUrl).toBe('https://api.commbank.com.au/public/cds-au/v1/banking/products')
  })

  it('matches CDR retail brand CommBank (register no longer uses full legal name)', () => {
    const cba = lender({
      code: 'cba',
      name: 'CBA',
      canonical_bank_name: 'Commonwealth Bank of Australia',
      register_brand_name: 'CommBank',
      products_endpoint: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
    })
    const commbankRetail: RegisterBrand = {
      brandName: 'CommBank',
      legalEntityName: '',
      endpointUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
    }
    expect(brandMatchScore(cba, commbankRetail)).toBeGreaterThan(0)
    expect(selectBestMatchingBrand(cba, [commbankRetail])?.endpointUrl).toBe(commbankRetail.endpointUrl)
  })

  it('does not use short lender codes as standalone brand matches', () => {
    const cba = lender({
      code: 'cba',
      name: 'CBA',
      canonical_bank_name: 'Commonwealth Bank of Australia',
      register_brand_name: 'Commonwealth Bank of Australia',
      products_endpoint: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
    })
    const commbizOnly: RegisterBrand = {
      brandName: 'CBA - CommBiz',
      legalEntityName: 'CommBiz',
      endpointUrl: 'https://cdr.commbiz.api.commbank.com.au/cbzpublic/cds-au/v1/banking/products',
    }

    expect(brandMatchScore(cba, commbizOnly)).toBe(0)
  })

  it('matches Bendigo to ACCC register brandName Bendigo Bank (not longer legal-style name)', () => {
    const bendigo = lender({
      code: 'bendigo_adelaide',
      name: 'Bendigo & Adelaide',
      canonical_bank_name: 'Bendigo and Adelaide Bank',
      register_brand_name: 'Bendigo Bank',
      products_endpoint: 'https://api.cdr.bendigobank.com.au/cds-au/v1/banking/products',
    })
    const registerRow: RegisterBrand = {
      brandName: 'Bendigo Bank',
      legalEntityName: '',
      endpointUrl: 'https://api.cdr.bendigobank.com.au/cds-au/v1/banking/products',
    }
    expect(brandMatchScore(bendigo, registerRow)).toBeGreaterThan(0)
    expect(selectBestMatchingBrand(bendigo, [registerRow])?.brandName).toBe('Bendigo Bank')
  })

  it('falls back to strong host affinity when register branding text drifts', () => {
    const bendigo = lender({
      code: 'bendigo_adelaide',
      name: 'Bendigo & Adelaide',
      canonical_bank_name: 'Bendigo and Adelaide Bank',
      register_brand_name: 'Bendigo and Adelaide Bank',
      products_endpoint: 'https://api.cdr.bendigobank.com.au/cds-au/v1/banking/products',
    })
    const registerRow: RegisterBrand = {
      brandName: 'BEN',
      legalEntityName: '',
      endpointUrl: 'https://api.cdr.bendigobank.com.au/cds-au/v1/banking/products',
    }
    expect(brandMatchScore(bendigo, registerRow)).toBe(0)
    expect(selectBestMatchingBrand(bendigo, [registerRow])?.endpointUrl).toBe(registerRow.endpointUrl)
  })

  it('prefers Great Southern retail over Business+ when retail is the configured primary endpoint', () => {
    const greatSouthern = lender({
      code: 'great_southern',
      name: 'Great Southern Bank',
      canonical_bank_name: 'Great Southern Bank',
      register_brand_name: 'Great Southern Bank',
      products_endpoint: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products',
      additional_products_endpoints: [
        'https://od1.open-banking.business.greatsouthernbank.com.au/api/cds-au/v1/banking/products',
      ],
    })
    const brands: RegisterBrand[] = [
      {
        brandName: 'Great Southern Bank Business+',
        legalEntityName: '',
        endpointUrl: 'https://od1.open-banking.business.greatsouthernbank.com.au/api/cds-au/v1/banking/products',
      },
      {
        brandName: 'Great Southern Bank',
        legalEntityName: '',
        endpointUrl: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products',
      },
    ]

    expect(selectBestMatchingBrand(greatSouthern, brands)?.endpointUrl).toBe(
      'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products',
    )
    expect(
      candidateProductEndpoints({
        cachedEndpointUrl: null,
        lender: greatSouthern,
        discoveredEndpointUrl: 'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products',
      }),
    ).toEqual([
      'https://api.open-banking.greatsouthernbank.com.au/cds-au/v1/banking/products',
      'https://od1.open-banking.business.greatsouthernbank.com.au/api/cds-au/v1/banking/products',
    ])
  })
})
