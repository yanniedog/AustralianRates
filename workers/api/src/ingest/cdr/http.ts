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
  const m = body.match(/Versions available:\s*([0-9,\s]+)/i)
  if (!m) return []
  return m[1]
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
}

export async function fetchCdrJson(url: string, versions: number[], context?: FetchRequestContext): Promise<FetchJsonResult> {
  const tried = new Set<number>()
  const queue = [...versions]
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
        'x-min-v': '1',
      },
      {
        ...context,
        sourceName: context?.sourceName || 'cdr_http',
      },
    )
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
    }
  }

  for (const fallbackVersion of [1, 2, 3, 4, 5, 6]) {
    if (tried.has(fallbackVersion)) continue
    const res = await fetchTextWithRetries(
      url,
      2,
      {
        accept: 'application/json',
        'x-v': String(fallbackVersion),
        'x-min-v': '1',
      },
      {
        ...context,
        sourceName: context?.sourceName || 'cdr_http',
      },
    )
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

  return fetchJson(url, context)
}
