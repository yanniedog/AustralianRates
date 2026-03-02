import { getText, isRecord, pickText, type JsonRecord } from './primitives'

export function safeUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeDateTime(value: unknown): string | null {
  const raw = getText(value)
  if (!raw) return null

  let normalized = raw
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    normalized = `${raw}T00:00:00Z`
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = raw.replace(' ', 'T') + 'Z'
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = `${raw}Z`
  }

  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString()
}

function pickNestedText(record: JsonRecord, parentKey: string, keys: string[]): string {
  const nested = record[parentKey]
  if (!nested) return ''

  if (isRecord(nested)) {
    return pickText(nested, keys)
  }

  if (Array.isArray(nested)) {
    for (const item of nested) {
      if (!isRecord(item)) continue
      const hit = pickText(item, keys)
      if (hit) return hit
    }
  }

  return ''
}

export function productUrlFromDetail(detail: JsonRecord, fallbackSourceUrl: string): string {
  const direct =
    pickText(detail, [
      'applicationUri',
      'applicationURL',
      'applicationUrl',
      'additionalInformationUri',
      'additionalInformationURL',
      'additionalInformationUrl',
      'uri',
      'url',
    ]) ||
    pickNestedText(detail, 'additionalInformation', [
      'overviewUri',
      'termsUri',
      'eligibilityUri',
      'feesAndPricingUri',
      'bundleUri',
      'applicationUri',
      'uri',
      'url',
    ])

  const candidate = getText(direct)
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return candidate
  }
  return fallbackSourceUrl
}

export function publishedAtFromDetail(detail: JsonRecord): string | null {
  return normalizeDateTime(
    pickText(detail, [
      'lastUpdated',
      'last_updated',
      'updatedAt',
      'updated_at',
      'lastModified',
      'last_modified',
    ]),
  )
}
