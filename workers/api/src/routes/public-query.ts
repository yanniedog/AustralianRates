export function parseCsvList(value: string | undefined): string[] {
  if (!value) return []
  return Array.from(
    new Set(
      String(value)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  )
}

export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null || String(value).trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseIncludeRemoved(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}
