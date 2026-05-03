import type { AnalyticsRepresentation } from '../routes/analytics-route-utils'
import {
  collectHomeLoanAnalyticsRowsResolved,
  collectSavingsAnalyticsRowsResolved,
  collectTdAnalyticsRowsResolved,
  type ResolvedAnalyticsRows,
} from '../routes/analytics-data'
import type { ChartCacheSection } from '../db/chart-cache'

type PublicCacheDbPair = Parameters<typeof collectHomeLoanAnalyticsRowsResolved>[0]
type PublicCacheFilters = Record<string, unknown>

type PublicCacheDatasetConfig = {
  section: ChartCacheSection
  routeSlug: 'home-loan-rates' | 'savings-rates' | 'term-deposit-rates'
  supportsConsumerDefaultPreset: boolean
  collectAnalyticsRows: (
    dbs: PublicCacheDbPair,
    representation: AnalyticsRepresentation,
    filters: PublicCacheFilters,
  ) => Promise<ResolvedAnalyticsRows>
}

// Single registry for public section coverage. Cache refresh, snapshot package
// scopes, graph data, and report/hierarchy payloads must derive from this list
// so mortgage, savings, and term-deposit handling cannot drift independently.
export const PUBLIC_CACHE_DATASETS = [
  {
    section: 'home_loans',
    routeSlug: 'home-loan-rates',
    supportsConsumerDefaultPreset: true,
    collectAnalyticsRows: (dbs, representation, filters) =>
      collectHomeLoanAnalyticsRowsResolved(
        dbs,
        representation,
        filters as Parameters<typeof collectHomeLoanAnalyticsRowsResolved>[2],
      ),
  },
  {
    section: 'savings',
    routeSlug: 'savings-rates',
    supportsConsumerDefaultPreset: true,
    collectAnalyticsRows: (dbs, representation, filters) =>
      collectSavingsAnalyticsRowsResolved(
        dbs,
        representation,
        filters as Parameters<typeof collectSavingsAnalyticsRowsResolved>[2],
      ),
  },
  {
    section: 'term_deposits',
    routeSlug: 'term-deposit-rates',
    supportsConsumerDefaultPreset: false,
    collectAnalyticsRows: (dbs, representation, filters) =>
      collectTdAnalyticsRowsResolved(dbs, representation, filters as Parameters<typeof collectTdAnalyticsRowsResolved>[2]),
  },
] as const satisfies readonly PublicCacheDatasetConfig[]

export const PUBLIC_CACHE_SECTIONS = PUBLIC_CACHE_DATASETS.map((dataset) => dataset.section) as readonly ChartCacheSection[]

export function publicCacheDatasetForSection(section: ChartCacheSection): PublicCacheDatasetConfig {
  const dataset = PUBLIC_CACHE_DATASETS.find((item) => item.section === section)
  if (!dataset) throw new Error(`unsupported_public_cache_section:${section}`)
  return dataset
}

export function sectionSupportsConsumerDefaultPreset(section: ChartCacheSection): boolean {
  return publicCacheDatasetForSection(section).supportsConsumerDefaultPreset
}
