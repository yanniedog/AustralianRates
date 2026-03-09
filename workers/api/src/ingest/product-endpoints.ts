import type { LenderConfig } from '../types'

function uniqueProductEndpoints(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

export function configuredProductEndpoints(
  lender: Pick<LenderConfig, 'products_endpoint' | 'additional_products_endpoints'>,
): string[] {
  return uniqueProductEndpoints([lender.products_endpoint, ...(lender.additional_products_endpoints ?? [])])
}

export function candidateProductEndpoints(input: {
  cachedEndpointUrl?: string | null
  lender: Pick<LenderConfig, 'products_endpoint' | 'additional_products_endpoints'>
  discoveredEndpointUrl?: string | null
}): string[] {
  return uniqueProductEndpoints([
    input.cachedEndpointUrl,
    ...configuredProductEndpoints(input.lender),
    input.discoveredEndpointUrl,
  ])
}
