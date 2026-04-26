import {
  buildPrecomputedChartScope,
  buildPrecomputedChartScopeForPreset,
  PRECOMPUTED_CHART_WINDOWS,
  type ChartCacheScope,
  type ChartCacheSection,
} from '../db/chart-cache'
import type { ChartWindow } from '../utils/chart-window'

export type PublicPackageScope = {
  section: ChartCacheSection
  scope: ChartCacheScope
}

export const PUBLIC_PACKAGE_SECTIONS: ChartCacheSection[] = ['home_loans', 'savings', 'term_deposits']
const PUBLIC_PACKAGE_WINDOW_PRIORITY: Array<ChartWindow | null> = ['30D', '90D', null, '180D', '1Y', 'ALL']

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
  if (options?.allScopes) {
    return PUBLIC_PACKAGE_SECTIONS.flatMap((section) =>
      precomputedSnapshotScopesForSection(section).map((scope) => ({ section, scope })),
    )
  }
  const items: PublicPackageScope[] = []
  const seen = new Set<string>()
  const push = (section: ChartCacheSection, scope: ChartCacheScope) => {
    const key = `${section}:${scope}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({ section, scope })
  }
  for (const window of PUBLIC_PACKAGE_WINDOW_PRIORITY) {
    for (const section of PUBLIC_PACKAGE_SECTIONS) {
      if (section === 'home_loans' || section === 'savings') {
        push(section, buildPrecomputedChartScopeForPreset(window, 'consumer-default'))
      }
      push(section, buildPrecomputedChartScope(window))
    }
  }
  return items
}

