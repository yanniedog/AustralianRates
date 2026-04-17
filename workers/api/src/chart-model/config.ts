/**
 * Server-side chart-model configuration.
 *
 * Ports the section-aware behaviour of `site/ar-chart-config.js`:
 *   - `rankDirection(section, field)` - `asc` for home-loans / fees / costs, otherwise `desc`.
 *   - `parseDensity(density, chartMaxProducts, mode)` - resolves the per-density row / compare limits
 *     with optional admin-configured `chart_max_products` cap.
 *
 * Clients use the same behaviour; any divergence would cause server-computed chartModels
 * to differ from what a client-side `buildChartModel` would produce for the same inputs.
 */

import type { ChartCacheSection } from '../db/chart-cache'

export type ChartSection = ChartCacheSection
/** UI-visible section id used in public URL state and palette lookups. */
export type ChartSectionSlug = 'home-loans' | 'savings' | 'term-deposits'

export const DENSITIES = {
  compact: { key: 'compact' as const, label: 'Compact', rowLimit: 12, compareLimit: 4 },
  standard: { key: 'standard' as const, label: 'Standard', rowLimit: 24, compareLimit: 6 },
  expanded: { key: 'expanded' as const, label: 'Expanded', rowLimit: 40, compareLimit: 8 },
}

export type DensityKey = keyof typeof DENSITIES
export type DensityResolved = {
  key: DensityKey
  label: string
  rowLimit: number
  compareLimit: number
  chartMaxProducts: number | null
}

export function sectionToSlug(section: ChartSection): ChartSectionSlug {
  if (section === 'home_loans') return 'home-loans'
  if (section === 'savings') return 'savings'
  return 'term-deposits'
}

/** Sort direction: lower-is-better for home loans, fees, and costs; higher-is-better otherwise. */
export function rankDirection(section: ChartSection, field: string): 'asc' | 'desc' {
  const key = String(field || '').toLowerCase()
  if (key.indexOf('fee') >= 0 || key.indexOf('cost') >= 0) return 'asc'
  if (key === 'rba_cash_rate') return section === 'home_loans' ? 'asc' : 'desc'
  return section === 'home_loans' ? 'asc' : 'desc'
}

export function parseDensity(
  value: string | undefined,
  chartMaxProducts?: number | null,
  chartMaxProductsMode?: 'default' | 'capped' | 'unlimited' | string | null,
): DensityResolved {
  const key = String(value || 'standard').trim().toLowerCase() as DensityKey
  const base = DENSITIES[key] ?? DENSITIES.standard
  const cap = chartMaxProducts
  const mode = String(chartMaxProductsMode || 'default').trim().toLowerCase()
  let rowLimit = base.rowLimit
  if (mode === 'unlimited') rowLimit = Number.MAX_SAFE_INTEGER
  if (Number.isFinite(Number(cap)) && Number(cap) > 0) rowLimit = Math.min(rowLimit, Number(cap))
  const compareLimit = mode === 'unlimited'
    ? Math.max(base.compareLimit, 12)
    : Math.max(1, Math.min(base.compareLimit, rowLimit))
  return {
    key: base.key,
    label: base.label,
    rowLimit,
    compareLimit,
    chartMaxProducts: Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : null,
  }
}

/** Default field spec matching the client's `defaultFields()`. */
export function defaultFieldsFor(section: ChartSection): {
  xField: 'collection_date'
  yField: 'interest_rate'
  groupField: 'product_key'
  density: 'standard'
  view: string
} {
  const view = section === 'home_loans'
    ? 'homeLoanReport'
    : section === 'savings'
      ? 'economicReport'
      : 'termDepositReport'
  return {
    xField: 'collection_date',
    yField: 'interest_rate',
    groupField: 'product_key',
    density: 'standard',
    view,
  }
}
