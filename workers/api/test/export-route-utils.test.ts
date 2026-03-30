import { describe, expect, it } from 'vitest'
import {
  appendCsvChunk,
  appendJsonChunk,
  buildJsonExportBody,
  collectPaginatedExportRows,
} from '../src/routes/export-route-utils'

describe('export-route-utils', () => {
  it('appends CSV rows with a single header row', () => {
    const lines: string[] = []
    const state = { headers: null as string[] | null }

    appendCsvChunk(lines, state, [{ bank_name: 'ANZ', interest_rate: 5.99 }])
    appendCsvChunk(lines, state, [{ bank_name: 'NAB', interest_rate: 6.01 }])

    expect(lines).toEqual([
      'bank_name,interest_rate',
      'ANZ,5.99',
      'NAB,6.01',
    ])
  })

  it('appends JSON rows as a comma-delimited sequence', () => {
    const parts: string[] = []
    const state = { firstRow: true }

    appendJsonChunk(parts, state, [{ bank_name: 'ANZ' }, { bank_name: 'NAB' }])

    expect(parts.join('')).toBe('{"bank_name":"ANZ"},\n{"bank_name":"NAB"}')
  })

  it('builds the stable JSON export wrapper body', () => {
    const body = buildJsonExportBody('savings', 'rates', 'change', 2, [
      '{"bank_name":"ANZ"}',
      ',\n{"bank_name":"NAB"}',
    ])

    expect(body).toBe('{"ok":true,"dataset":"savings","export_scope":"rates","representation":"change","count":2,"rows":[{"bank_name":"ANZ"},\n{"bank_name":"NAB"}]}')
  })

  it('collects paginated rows across all pages', async () => {
    const rows = await collectPaginatedExportRows(async (page, size) => {
      expect(size).toBe(1000)
      if (page === 1) return { data: [{ id: 1 }], last_page: 2 }
      if (page === 2) return { data: [{ id: 2 }], last_page: 2 }
      return { data: [], last_page: 2 }
    })

    expect(rows).toEqual([{ id: 1 }, { id: 2 }])
  })
})
