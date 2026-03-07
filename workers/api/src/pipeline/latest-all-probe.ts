import { API_BASE_PATH, SAVINGS_API_BASE_PATH, TD_API_BASE_PATH } from '../constants'

export type LatestAllProbeDataset = 'home_loans' | 'savings' | 'term_deposits'

export type LatestAllDatasetConfig = {
  dataset: LatestAllProbeDataset
  basePath: string
}

export const LATEST_ALL_PROBE_SOURCE_MODE = 'all'

export const LATEST_ALL_DATASETS: LatestAllDatasetConfig[] = [
  { dataset: 'home_loans', basePath: API_BASE_PATH },
  { dataset: 'savings', basePath: SAVINGS_API_BASE_PATH },
  { dataset: 'term_deposits', basePath: TD_API_BASE_PATH },
]

export function buildLatestAllProbePath(
  basePath: string,
  input?: { limit?: number; sourceMode?: typeof LATEST_ALL_PROBE_SOURCE_MODE; cacheBust?: number | null },
): string {
  const limit = Math.max(1, Math.floor(Number(input?.limit) || 25))
  const params = new URLSearchParams({
    limit: String(limit),
    source_mode: input?.sourceMode || LATEST_ALL_PROBE_SOURCE_MODE,
  })
  if (input?.cacheBust) {
    params.set('cache_bust', String(Math.max(1, Math.floor(Number(input.cacheBust)))))
  }
  return `${basePath}/latest-all?${params.toString()}`
}
