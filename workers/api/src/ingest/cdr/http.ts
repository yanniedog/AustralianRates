import type { FetchRetryEnv, FetchWithTimeoutMeta } from '../../utils/fetch-with-timeout.js'
import { FetchWithTimeoutError, fetchWithTimeout, hostFromUrl } from '../../utils/fetch-with-timeout.js'
import { log } from '../../utils/logger.js'

export type FetchJsonResult = {
  ok: boolean
  status: number
  url: string
  data: unknown
  text: string
}

export type FetchRequestContext = {
  env?: FetchRetryEnv
  sourceName?: string
  runId?: string
  lenderCode?: string
}

function fallbackMeta(error: unknown): FetchWithTimeoutMeta {
  return {
    attempts: 1,
    elapsed_ms: 0,
    timed_out: false,
    status: null,
    retry_reasons: [],
    last_error_class: 'network',
  }
}

function logUpstreamRequest(
  url: string,
  meta: FetchWithTimeoutMeta,
  context?: FetchRequestContext,
  level: 'info' | 'warn' = 'info',
): void {
  const sourceName = context?.sourceName || 'cdr_http'
  const retryReasons = meta.retry_reasons.length > 0 ? meta.retry_reasons.join('|') : 'none'
  const messageContext =
    `source=${sourceName} host=${hostFromUrl(url)}` +
    ` elapsed_ms=${meta.elapsed_ms} upstream_ms=${meta.elapsed_ms}` +
    ` attempts=${meta.attempts} retry_count=${Math.max(0, meta.attempts - 1)}` +
    ` timed_out=${meta.timed_out ? 1 : 0} timeout=${meta.timed_out ? 1 : 0}` +
    ` status=${meta.status ?? 0} last_error_class=${meta.last_error_class}` +
    ` retry_reasons=${retryReasons}`

  if (level === 'warn') {
    log.warn('ingest', 'upstream_fetch', {
      runId: context?.runId,
      lenderCode: context?.lenderCode,
      context: messageContext,
    })
    return
  }

  log.info('ingest', 'upstream_fetch', {
    runId: context?.runId,
    lenderCode: context?.lenderCode,
    context: messageContext,
  })
}

async function fetchTextWithRetries(
  url: string,
  retries = 2,
  headers: Record<string, string> = { accept: 'application/json' },
  context?: FetchRequestContext,
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const { response, meta } = await fetchWithTimeout(
      url,
      {
        headers,
      },
      {
        env: context?.env,
        maxRetries: retries,
      },
    )
    logUpstreamRequest(url, meta, context)
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      text,
    }
  } catch (error) {
    const timeoutError = error instanceof FetchWithTimeoutError ? error : null
    const meta: FetchWithTimeoutMeta = timeoutError?.meta ?? fallbackMeta(error)
    logUpstreamRequest(url, meta, context, 'warn')
    const message = (error as Error)?.message || String(error)
    return {
      ok: false,
      status: meta.status ?? 500,
      text: message,
    }
  }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasCdrErrors(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (Array.isArray(data.errors) && data.errors.length > 0) return true
  const errorCode = typeof data.errorCode === 'string' ? data.errorCode.trim() : ''
  const errorMessage = typeof data.errorMessage === 'string' ? data.errorMessage.trim() : ''
  return errorCode.length > 0 || errorMessage.length > 0
}

export async function fetchJson(url: string, context?: FetchRequestContext): Promise<FetchJsonResult> {
  const response = await fetchTextWithRetries(url, 2, { accept: 'application/json' }, context)
  const data = parseJsonSafe(response.text)
  return {
    ok: response.ok && data != null && !hasCdrErrors(data),
    status: response.status,
    url,
    data,
    text: response.text,
  }
}

function parseSupportedVersions(body: string): number[] {
  const available = body.match(/Versions available:\s*([0-9,\s]+)/i)
  if (available) {
    return available[1]
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x))
  }

  const range = body.match(/Minimum version supported is\s*(\d+)\s*and\s*Maximum version supported is\s*(\d+)/i)
  if (!range) return []
  const min = Number(range[1])
  const max = Number(range[2])
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return []
  return Array.from({ length: max - min + 1 }, (_item, index) => max - index)
}

type UnsupportedVersionProbe = {
  versionTried: number
  bodySnippet: string
}

/**
 * Probe CDR endpoint across versions, sending `x-min-v` equal to `x-v` on each probe.
 *
 * Historically we sent `x-min-v: 1` with a varying `x-v`, betting the server would pick the
 * highest supported version in our range. NAB (2026-04) tightened their API and started
 * returning 400/406 UnsupportedVersion when `x-min-v` falls below their supported minimum
 * (e.g. Min=4 Max=6), even when the intersection with our range would be non-empty. A
 * strict `x-min-v = x-v` probe is unambiguous: each attempt asks for exactly one version
 * and the server either returns that version or rejects. The caller controls the order
 * (highest first) so we still prefer the newest supported version.
 */
export async function fetchCdrJson(url: string, versions: number[], context?: FetchRequestContext): Promise<FetchJsonResult> {
  const tried = new Set<number>()
  const queue = [...versions]
  const unsupportedVersionProbes: UnsupportedVersionProbe[] = []
  let lastProbe: { status: number; text: string } | null = null
  while (queue.length > 0) {
    const version = Number(queue.shift())
    if (!Number.isFinite(version) || tried.has(version)) continue
    tried.add(version)

    const res = await fetchTextWithRetries(
      url,
      2,
      {
        accept: 'application/json',
        'x-v': String(version),
        'x-min-v': String(version),
      },
      {
        ...context,
        sourceName: context?.sourceName || 'cdr_http',
      },
    )
    lastProbe = { status: res.status, text: res.text }
    const data = parseJsonSafe(res.text)
    if (res.ok && data != null && !hasCdrErrors(data)) {
      return {
        ok: true,
        status: res.status,
        url,
        data,
        text: res.text,
      }
    }
    if (res.status === 406) {
      const advertised = parseSupportedVersions(res.text)
      for (const x of advertised) {
        if (!tried.has(x)) queue.push(x)
      }
      if (advertised.length === 0) {
        unsupportedVersionProbes.push({
          versionTried: version,
          bodySnippet: (res.text || '').slice(0, 300).replace(/\s+/g, ' ').trim() || 'empty',
        })
      }
    }
  }

  for (const fallbackVersion of [6, 5, 4, 3, 2, 1]) {
    if (tried.has(fallbackVersion)) continue
    const res = await fetchTextWithRetries(
      url,
      2,
      {
        accept: 'application/json',
        'x-v': String(fallbackVersion),
        'x-min-v': String(fallbackVersion),
      },
      {
        ...context,
        sourceName: context?.sourceName || 'cdr_http',
      },
    )
    lastProbe = { status: res.status, text: res.text }
    const data = parseJsonSafe(res.text)
    if (res.ok && data != null && !hasCdrErrors(data)) {
      return {
        ok: true,
        status: res.status,
        url,
        data,
        text: res.text,
      }
    }
  }

  if (unsupportedVersionProbes.length > 0) {
    const attempts = unsupportedVersionProbes
      .slice(0, 4)
      .map((probe) => `x_v_tried=${probe.versionTried} body_snippet=${probe.bodySnippet}`)
      .join(' | ')
    log.warn('ingest', 'cdr_406_no_versions_advertised', {
      runId: context?.runId,
      lenderCode: context?.lenderCode,
      context: `url=${url} attempts=${unsupportedVersionProbes.length} ${attempts}`,
    })
  }

  const finalText = lastProbe?.text || ''
  return {
    ok: false,
    status: lastProbe?.status ?? 0,
    url,
    data: parseJsonSafe(finalText),
    text: finalText,
  }
}
