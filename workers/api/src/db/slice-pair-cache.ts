import {
  CHART_CACHE_KV_TTL,
  buildChartCacheKey,
  type ChartCacheSection,
} from './chart-cache'
import type { SlicePairStatsPayload } from './slice-pair-stats'

/** Bump when response JSON shape changes. */

export const SLICE_PAIR_STATS_PAYLOAD_VERSION = 2

function normalizeScopeParams(
  params: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...params }
  const datasetMode = normalized.dataset_mode
  delete normalized.dataset_mode
  normalized.mode = datasetMode
  return normalized
}

export function buildSlicePairStatsCacheKey(
  section: ChartCacheSection,
  params: Record<string, string | undefined>,
): string {
  return buildChartCacheKey(section, `slice-pair-stats:v${SLICE_PAIR_STATS_PAYLOAD_VERSION}`, normalizeScopeParams(params))
}

export async function getCachedOrComputeSlicePairStats(
  env: { DB: D1Database; CHART_CACHE_KV?: KVNamespace },
  section: ChartCacheSection,
  params: Record<string, string | undefined>,
  compute: () => Promise<SlicePairStatsPayload>,
  options?: { allowLiveCompute?: boolean },
): Promise<SlicePairStatsPayload & { fromCache: 'kv' | 'live' }> {
  const key = buildSlicePairStatsCacheKey(section, params)
  if (env.CHART_CACHE_KV) {
    const kvCached = await env.CHART_CACHE_KV.get(key)
    if (kvCached) {
      try {
        const parsed = JSON.parse(kvCached) as { v?: number; stats?: SlicePairStatsPayload }
        if (parsed?.v === SLICE_PAIR_STATS_PAYLOAD_VERSION && parsed.stats) {
          return { ...parsed.stats, fromCache: 'kv' }
        }
      } catch {
        /* ignore invalid KV entry */
      }
    }
  }

  if (options?.allowLiveCompute === false) {
    throw new Error(`slice_pair_live_compute_disabled:${section}`)
  }

  const stats = await compute()
  try {
    const wrapped = JSON.stringify({ v: SLICE_PAIR_STATS_PAYLOAD_VERSION, stats })
    if (env.CHART_CACHE_KV) {
      await env.CHART_CACHE_KV.put(key, wrapped, { expirationTtl: CHART_CACHE_KV_TTL })
    }
  } catch {
    /* ignore KV write failure */
  }
  return { ...stats, fromCache: 'live' }
}
