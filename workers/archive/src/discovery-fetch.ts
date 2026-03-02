const FETCH_TIMEOUT_MS = 20000
const MAX_RETRIES_PER_URL = 3
const RETRY_DELAY_MS = 1500

export const CDR_REGISTER_PRIMARY = 'https://api.cdr.gov.au/cdr-register/v1/banking/register'
export const CDR_REGISTER_FALLBACK = 'https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<[Response, string]> {
  const { timeoutMs = FETCH_TIMEOUT_MS, ...fetchOpts } = options
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      ...fetchOpts,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(fetchOpts.headers as object) },
    })
    const text = await resp.text()
    return [resp, text]
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchWithRetry(url: string): Promise<{ resp: Response; body: string; url: string } | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_URL; attempt++) {
    try {
      const [resp, body] = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS })
      return { resp, body, url }
    } catch (error) {
      console.error('discoverCdrRegister fetch attempt', {
        url,
        attempt,
        error: (error as Error)?.message,
      })
      if (attempt < MAX_RETRIES_PER_URL) {
        await sleep(RETRY_DELAY_MS * attempt)
      } else {
        return null
      }
    }
  }
  return null
}

export function normalizeBaseUrl(url: string): string {
  let normalized = (url || '').trim()
  if (!normalized) return ''
  try {
    const parsed = new URL(normalized)
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.origin + parsed.pathname
  } catch {
    return normalized.replace(/\/+$/, '')
  }
}

export function deriveProductsUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, '')
  return base ? `${base}/cds-au/v1/banking/products` : ''
}
