type HeaderMap = Headers | Record<string, string> | null | undefined

export type UpstreamBlockDetection = {
  blocked: boolean
  reasonCode: 'upstream_block_cloudflare' | 'upstream_block_waf' | null
  provider: 'cloudflare' | 'waf' | null
  marker: string | null
}

function normalizeText(value: unknown): string {
  return String(value ?? '').toLowerCase()
}

function headerValue(headers: HeaderMap, key: string): string {
  if (!headers) return ''
  if (headers instanceof Headers) return headers.get(key) || ''
  return String(headers[key] ?? '')
}

function cloudflareMarker(body: string): string | null {
  const markers = [
    'sorry, you have been blocked',
    'attention required! | cloudflare',
    'cloudflare ray id',
    'error 1020',
  ]
  for (const marker of markers) {
    if (body.includes(marker)) return marker
  }
  return null
}

function wafMarker(body: string): string | null {
  const markers = ['web application firewall', 'request blocked', 'waf block', 'firewall policy']
  for (const marker of markers) {
    if (body.includes(marker)) return marker
  }
  if (body.includes('access denied') && (body.includes('firewall') || body.includes('waf'))) {
    return 'access denied + firewall'
  }
  if (body.includes('access denied') && body.includes('edgesuite.net')) {
    return 'akamai edgesuite access denied'
  }
  return null
}

export function detectUpstreamBlock(input: {
  status?: number | null
  body?: string | null
  headers?: HeaderMap
}): UpstreamBlockDetection {
  const status = Number.isFinite(Number(input.status)) ? Number(input.status) : 0
  const body = normalizeText(input.body)
  const server = normalizeText(headerValue(input.headers, 'server'))
  const cfRay = normalizeText(headerValue(input.headers, 'cf-ray'))

  const cfMarker = cloudflareMarker(body)
  if (cfMarker) {
    return {
      blocked: true,
      reasonCode: 'upstream_block_cloudflare',
      provider: 'cloudflare',
      marker: cfMarker,
    }
  }

  if ((server.includes('cloudflare') || cfRay) && status >= 400 && body.includes('blocked')) {
    return {
      blocked: true,
      reasonCode: 'upstream_block_cloudflare',
      provider: 'cloudflare',
      marker: 'cloudflare headers + blocked body',
    }
  }

  const genericWafMarker = wafMarker(body)
  if (genericWafMarker) {
    return {
      blocked: true,
      reasonCode: 'upstream_block_waf',
      provider: 'waf',
      marker: genericWafMarker,
    }
  }

  return {
    blocked: false,
    reasonCode: null,
    provider: null,
    marker: null,
  }
}

export function upstreamBlockNote(block: UpstreamBlockDetection): string | null {
  if (!block.blocked || !block.reasonCode) return null
  const marker = block.marker ? ` marker=${block.marker}` : ''
  return `${block.reasonCode}${marker}`
}
