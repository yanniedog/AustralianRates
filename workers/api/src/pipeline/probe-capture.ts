import { persistRawPayload } from '../db/raw-payloads'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'
import { detectUpstreamBlock, upstreamBlockNote } from '../utils/upstream-block'

const SUCCESS_SAMPLE_RATE = 0.05

export type ProbeCaptureReason =
  | 'success'
  | 'api_invalid_payload'
  | 'api_no_recent_data'
  | 'api_unreachable'

export type ProbeCaptureResult = {
  captured: boolean
  sampledSuccess: boolean
  fetchEventId: number | null
}

function shouldCapture(reason: ProbeCaptureReason): { capture: boolean; sampledSuccess: boolean } {
  if (reason !== 'success') return { capture: true, sampledSuccess: false }
  const sampled = Math.random() < SUCCESS_SAMPLE_RATE
  return { capture: sampled, sampledSuccess: sampled }
}

function buildNotes(input: {
  reason: ProbeCaptureReason
  note?: string | null
  bodyText: string
  status: number | null
  headers?: Headers | Record<string, string> | null
}): string {
  const parts: string[] = [`probe_capture reason=${input.reason}`]
  if (input.note) parts.push(input.note)
  const block = detectUpstreamBlock({
    status: input.status,
    body: input.bodyText,
    headers: input.headers,
  })
  const blockNote = upstreamBlockNote(block)
  if (blockNote) parts.push(blockNote)
  return parts.join(' ')
}

export async function captureProbePayload(
  env: EnvBindings,
  input: {
    sourceType: string
    sourceUrl: string
    reason: ProbeCaptureReason
    payload: unknown
    status?: number | null
    headers?: Headers | Record<string, string> | null
    durationMs?: number | null
    note?: string | null
  },
): Promise<ProbeCaptureResult> {
  const decision = shouldCapture(input.reason)
  if (!decision.capture) {
    return { captured: false, sampledSuccess: false, fetchEventId: null }
  }

  const bodyText =
    typeof input.payload === 'string'
      ? input.payload
      : (() => {
          try {
            return JSON.stringify(input.payload ?? null)
          } catch {
            return String(input.payload)
          }
        })()

  try {
    const persisted = await persistRawPayload(env, {
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      payload: input.payload,
      httpStatus: input.status ?? null,
      responseHeaders: input.headers ?? null,
      durationMs: input.durationMs ?? null,
      notes: buildNotes({
        reason: input.reason,
        note: input.note ?? null,
        bodyText,
        status: input.status ?? null,
        headers: input.headers,
      }),
    })
    return {
      captured: true,
      sampledSuccess: decision.sampledSuccess,
      fetchEventId: persisted.fetchEventId ?? null,
    }
  } catch (error) {
    log.warn('pipeline', 'probe_payload_capture_failed', {
      error,
      context:
        `source=${input.sourceType} reason=${input.reason}` +
        ` status=${input.status ?? 0} url=${input.sourceUrl}`,
    })
    return {
      captured: false,
      sampledSuccess: decision.sampledSuccess,
      fetchEventId: null,
    }
  }
}
