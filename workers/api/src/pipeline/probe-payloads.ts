type JsonObject = Record<string, unknown>

export type RowsPayloadParseResult =
  | { ok: true; rows: JsonObject[] }
  | { ok: false; reason: string }

export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!String(text || '').trim()) {
    return { ok: false, reason: 'empty_body' }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseRowsPayload(value: unknown): RowsPayloadParseResult {
  if (!isJsonObject(value)) {
    return { ok: false, reason: 'payload_not_object' }
  }
  const rawRows = Array.isArray(value.rows)
    ? value.rows
    : Array.isArray(value.data)
      ? value.data
      : null
  if (!rawRows) {
    return { ok: false, reason: 'missing_rows_array' }
  }
  if (!rawRows.every((row) => isJsonObject(row))) {
    return { ok: false, reason: 'rows_must_be_objects' }
  }
  return { ok: true, rows: rawRows as JsonObject[] }
}

export function normalizeIsoDateLike(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : text
}

export function extractCollectionDates(rows: JsonObject[]): string[] {
  const dates: string[] = []
  for (const row of rows) {
    const normalized = normalizeIsoDateLike(row.collection_date)
    if (normalized) dates.push(normalized)
  }
  return dates
}
