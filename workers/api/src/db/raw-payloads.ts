import type { DatasetKind, IngestTaskKind } from '../../../../packages/shared/src'
import { persistFetchEvent } from './fetch-events'

type RawPayloadInput = {
  sourceType: string
  sourceUrl: string
  payload: unknown
  fetchedAtIso?: string
  httpStatus?: number | null
  notes?: string | null
  runId?: string | null
  lenderCode?: string | null
  dataset?: DatasetKind | null
  jobKind?: IngestTaskKind | string | null
  collectionDate?: string | null
  durationMs?: number | null
  productId?: string | null
  responseHeaders?: Headers | Record<string, string> | null
}

type RawPayloadResult = {
  inserted: boolean
  id: number | null
  contentHash: string
  r2Key: string
  fetchEventId: number | null
  rawObjectCreated: boolean
  bodyBytes: number
}

type RawEnv = {
  DB: D1Database
  RAW_BUCKET: R2Bucket
}

export async function persistRawPayload(env: RawEnv, input: RawPayloadInput): Promise<RawPayloadResult> {
  const result = await persistFetchEvent(env, input)
  return {
    inserted: result.rawObjectCreated,
    id: result.fetchEventId,
    contentHash: result.contentHash,
    r2Key: result.r2Key,
    fetchEventId: result.fetchEventId,
    rawObjectCreated: result.rawObjectCreated,
    bodyBytes: result.bodyBytes,
  }
}
