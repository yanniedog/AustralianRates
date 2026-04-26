import {
  buildPrecomputedChartScope,
  buildPrecomputedChartScopeForPreset,
  PRECOMPUTED_CHART_WINDOWS,
  type ChartCacheScope,
  type ChartCacheSection,
} from '../db/chart-cache'

export type PublicPackageScope = {
  section: ChartCacheSection
  scope: ChartCacheScope
}

export const PUBLIC_PACKAGE_SECTIONS: ChartCacheSection[] = ['home_loans', 'savings', 'term_deposits']

function uniqueScopes(scopes: ChartCacheScope[]): ChartCacheScope[] {
  return Array.from(new Set(scopes))
}

export function precomputedSnapshotScopesForSection(section: ChartCacheSection): ChartCacheScope[] {
  const raw: ChartCacheScope[] = [null, ...PRECOMPUTED_CHART_WINDOWS].map((window) =>
    buildPrecomputedChartScope(window),
  )
  if (section === 'home_loans' || section === 'savings') {
    return raw.concat(
      [null, ...PRECOMPUTED_CHART_WINDOWS].map((window) =>
        buildPrecomputedChartScopeForPreset(window, 'consumer-default'),
      ),
    )
  }
  return raw
}

export function publicSnapshotScopesForSection(
  section: ChartCacheSection,
  options?: { allScopes?: boolean },
): ChartCacheScope[] {
  if (options?.allScopes) return precomputedSnapshotScopesForSection(section)

  const rawScopes: ChartCacheScope[] = [
    buildPrecomputedChartScope(null),
    ...PRECOMPUTED_CHART_WINDOWS.map((window) => buildPrecomputedChartScope(window)),
  ]
  if (section === 'home_loans' || section === 'savings') {
    return uniqueScopes([
      ...rawScopes,
      buildPrecomputedChartScopeForPreset(null, 'consumer-default'),
      ...PRECOMPUTED_CHART_WINDOWS.map((window) =>
        buildPrecomputedChartScopeForPreset(window, 'consumer-default'),
      ),
    ])
  }
  return uniqueScopes(rawScopes)
}

export function publicSnapshotPackageScopeItems(options?: { allScopes?: boolean }): PublicPackageScope[] {
  return PUBLIC_PACKAGE_SECTIONS.flatMap((section) =>
    publicSnapshotScopesForSection(section, options).map((scope) => ({ section, scope })),
  )
}
