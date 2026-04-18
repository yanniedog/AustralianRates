/**
 * Describe Cloudflare token-create (or similar) JSON for stderr without echoing secrets.
 */

export function describeTokenCreateResponse(r: unknown): string {
  if (r == null) return '(null/undefined)'
  if (typeof r !== 'object') return `type=${typeof r}`
  const o = r as Record<string, unknown>
  const top = Object.keys(o).join(',')
  const res = o.result
  if (res != null && typeof res === 'object') {
    const ro = res as Record<string, unknown>
    const rk = Object.keys(ro).join(',')
    const sensitive = Object.keys(ro).filter((k) => /^(value|token|secret|id)$/i.test(k))
    return `topKeys=[${top}] result.keys=[${rk}] result.sensitiveKeyCount=${sensitive.length}`
  }
  return `topKeys=[${top}] resultType=${res == null ? 'null' : typeof res}`
}
