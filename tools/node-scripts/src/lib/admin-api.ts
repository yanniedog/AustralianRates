const DEFAULT_ORIGIN = 'https://www.australianrates.com'

export function resolveEnvOrigin(keys: string[], defaultOrigin = DEFAULT_ORIGIN): string {
  for (const key of keys) {
    const raw = String(process.env[key] || '').trim()
    if (raw) return new URL(raw).origin
  }
  return defaultOrigin
}

export function resolveAdminToken(keys: string[]): string {
  for (const key of keys) {
    const raw = String(process.env[key] || '').trim()
    if (!raw) continue
    if (key === 'ADMIN_API_TOKENS') {
      const first = raw.split(',')[0]?.trim()
      if (first) return first
      continue
    }
    return raw
  }
  return ''
}

export function buildAdminHeaders(
  token: string,
  accept: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    ...extra,
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}
