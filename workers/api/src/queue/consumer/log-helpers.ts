export function summarizeDropReasons(items: Array<{ reason: string }>): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const item of items) {
    const reason = item.reason || 'unknown'
    summary[reason] = (summary[reason] || 0) + 1
  }
  return summary
}

export function summarizeEndpointHosts(values: string[]): string {
  return values
    .map((value) => {
      try {
        return new URL(value).host
      } catch {
        return value
      }
    })
    .join(',')
}

export function shortUrlForLog(value: string): string {
  if (!value) return value
  try {
    const parsed = new URL(value)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return value
  }
}

export function summarizeProductSample(productIds: string[], limit = 5): string {
  const sample = Array.from(new Set(productIds.filter(Boolean))).slice(0, limit)
  return sample.join('|') || 'none'
}

export function serializeForLog(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function summarizeStatusCodes(statuses: Array<number | undefined>): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const status of statuses) {
    const key = Number.isFinite(Number(status)) ? String(status) : 'unknown'
    summary[key] = (summary[key] || 0) + 1
  }
  return summary
}

export function mergeSummary(target: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  for (const [key, value] of Object.entries(incoming)) {
    target[key] = (target[key] || 0) + Number(value || 0)
  }
  return target
}

export function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs)
}
