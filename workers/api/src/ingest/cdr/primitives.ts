export type JsonRecord = Record<string, unknown>

export function isRecord(v: unknown): v is JsonRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export function getText(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

export function pickText(obj: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key]
    const text = getText(v)
    if (text) return text
  }
  return ''
}
