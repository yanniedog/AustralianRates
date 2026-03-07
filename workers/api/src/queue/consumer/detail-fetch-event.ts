import { resolveFetchEventIdByPayloadIdentity } from '../../db/fetch-events'
import { persistRawPayload } from '../../db/raw-payloads'
import type { EnvBindings } from '../../types'

type DetailFetchEventInput = Parameters<typeof persistRawPayload>[1] & {
  sourceType: 'cdr_product_detail'
}

export async function ensureProductDetailFetchEventId(
  env: Pick<EnvBindings, 'DB' | 'RAW_BUCKET'>,
  input: DetailFetchEventInput,
): Promise<Awaited<ReturnType<typeof persistRawPayload>> & { fetchEventId: number }> {
  const persisted = await persistRawPayload(env, input)
  if (persisted.fetchEventId != null) {
    return {
      ...persisted,
      fetchEventId: persisted.fetchEventId,
    }
  }

  const fetchEventId = await resolveFetchEventIdByPayloadIdentity(env.DB, {
    runId: input.runId ?? null,
    lenderCode: input.lenderCode ?? null,
    dataset: input.dataset ?? null,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    contentHash: persisted.contentHash,
    productId: input.productId ?? null,
    collectionDate: input.collectionDate ?? null,
  })
  if (fetchEventId == null) {
    throw new Error(
      `detail_lineage_persist_failed:${input.dataset ?? 'unknown'}:${input.productId ?? 'unknown'}:${persisted.contentHash}`,
    )
  }

  return {
    ...persisted,
    fetchEventId,
  }
}
