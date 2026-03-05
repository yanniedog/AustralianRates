import { describe, expect, it } from 'vitest'
import { resolveProductDetailEndpoint } from '../src/queue/consumer/handlers/product-detail'

describe('product detail endpoint resolution', () => {
  it('prefers explicit job endpoint over cached endpoint', () => {
    const resolved = resolveProductDetailEndpoint(
      { endpointUrl: 'https://id.ob.ing.com.au/cds-au/v1/banking/products' },
      { endpointUrl: 'https://public.ob.business.hsbc.com.au/cds-au/v1/banking/products' },
    )

    expect(resolved).toEqual({
      endpointUrl: 'https://id.ob.ing.com.au/cds-au/v1/banking/products',
      endpointSource: 'job_override',
    })
  })

  it('falls back to cache when job override is absent', () => {
    const resolved = resolveProductDetailEndpoint(
      { endpointUrl: undefined },
      { endpointUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products' },
    )

    expect(resolved).toEqual({
      endpointUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
      endpointSource: 'cache',
    })
  })
})
