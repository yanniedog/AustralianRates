import type { DatasetKind } from '../../../../packages/shared/src'

type ActiveCdrProductRefRow = {
  product_id: string
  latest_source_url: string | null
}

export type ActiveCdrProductRef = {
  productId: string
  endpointUrl: string
}

export function cdrProductEndpointUrlFromSourceUrl(sourceUrl: string | null | undefined): string | null {
  const raw = String(sourceUrl || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    const marker = '/banking/products'
    const lowerPath = url.pathname.toLowerCase()
    const markerIndex = lowerPath.indexOf(marker)
    if (markerIndex < 0) return null

    url.pathname = url.pathname.slice(0, markerIndex + marker.length)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export async function getActiveCdrProductRefs(
  db: D1Database,
  input: { dataset: DatasetKind; bankName: string; limit?: number },
): Promise<ActiveCdrProductRef[]> {
  const result = await db
    .prepare(
      `SELECT
         pc.product_id,
         pc.latest_source_url
       FROM product_catalog pc
       LEFT JOIN product_presence_status pps
         ON pps.section = pc.dataset_kind
        AND pps.bank_name = pc.bank_name
        AND pps.product_id = pc.product_id
       WHERE pc.dataset_kind = ?1
         AND pc.bank_name = ?2
         AND COALESCE(pps.is_removed, pc.is_removed, 0) = 0
       ORDER BY pc.last_seen_at DESC
       LIMIT ?3`,
    )
    .bind(input.dataset, input.bankName, Math.max(1, Math.floor(input.limit ?? 500)))
    .all<ActiveCdrProductRefRow>()

  const refs = new Map<string, string>()
  for (const row of result.results ?? []) {
    const productId = String(row.product_id || '').trim()
    const endpointUrl = cdrProductEndpointUrlFromSourceUrl(row.latest_source_url)
    if (!productId || !endpointUrl || refs.has(productId)) continue
    refs.set(productId, endpointUrl)
  }

  return Array.from(refs.entries()).map(([productId, endpointUrl]) => ({ productId, endpointUrl }))
}
