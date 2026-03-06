import { describe, expect, it } from 'vitest'
import { assignFetchEventIdsBySourceUrl } from '../src/queue/consumer/lineage'

describe('lineage mapping helpers', () => {
  it('assigns missing row lineage ids from persisted payload source url mapping', () => {
    const rows = [
      {
        sourceUrl: 'https://web.archive.org/web/20260301000000id_/https://example.com/products/abc',
        fetchEventId: null,
      },
      {
        sourceUrl: 'https://web.archive.org/web/20260301000000id_/https://example.com/products/def',
        fetchEventId: 99,
      },
    ]
    const mapping = new Map<string, number>([
      ['https://web.archive.org/web/20260301000000id_/https://example.com/products/abc', 42],
      ['https://web.archive.org/web/20260301000000id_/https://example.com/products/def', 77],
    ])

    assignFetchEventIdsBySourceUrl(rows, mapping)

    expect(rows[0].fetchEventId).toBe(42)
    expect(rows[1].fetchEventId).toBe(99)
  })
})
