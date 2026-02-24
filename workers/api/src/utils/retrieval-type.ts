import type { RetrievalType } from '../types'

export function deriveRetrievalType(dataQualityFlag: unknown, sourceUrl: unknown): RetrievalType {
  const flag = String(dataQualityFlag ?? '').toLowerCase()
  const url = String(sourceUrl ?? '').toLowerCase()
  if (flag.startsWith('parsed_from_wayback') || url.includes('web.archive.org/web/')) {
    return 'historical_scrape'
  }
  return 'present_scrape_same_date'
}
