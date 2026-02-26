import { describe, expect, it } from 'vitest'
import { buildListMeta, setCsvMetaHeaders } from '../src/utils/response-meta'

describe('response meta disclosures', () => {
  it('includes comparison-rate disclosure in JSON meta payloads', () => {
    const meta = buildListMeta({
      sourceMode: 'scheduled',
      totalRows: 10,
      returnedRows: 10,
      sourceMix: { scheduled: 10, manual: 0 },
      limited: false,
      disclosures: {
        comparison_rate: {
          loan_amount_aud: 150000,
          term_years: 25,
          statement: 'Benchmark only.',
          limitations: ['Varies by fees.'],
        },
      },
    })

    expect(meta.disclosures?.comparison_rate?.loan_amount_aud).toBe(150000)
    expect(meta.disclosures?.comparison_rate?.term_years).toBe(25)
    expect(meta.disclosures?.comparison_rate?.statement).toContain('Benchmark')
    expect(meta.disclosures?.comparison_rate?.limitations).toEqual(['Varies by fees.'])
  })

  it('emits disclosure headers for CSV exports', () => {
    const headers = new Map<string, string>()
    const c = {
      header: (name: string, value: string) => {
        headers.set(name, value)
      },
    }

    const meta = buildListMeta({
      sourceMode: 'scheduled',
      totalRows: 2,
      returnedRows: 2,
      sourceMix: { scheduled: 2, manual: 0 },
      limited: false,
      disclosures: {
        comparison_rate: {
          loan_amount_aud: 150000,
          term_years: 25,
          statement: 'Benchmark only.',
          limitations: ['Varies by fees.', 'Confirm with lender.'],
        },
      },
    })

    setCsvMetaHeaders(c, meta)

    expect(headers.get('X-AR-Comparison-Rate-Basis')).toBe('$150000 over 25 years')
    expect(headers.get('X-AR-Comparison-Rate-Statement')).toBe('Benchmark only.')
    expect(headers.get('X-AR-Comparison-Rate-Limitations')).toContain('Confirm with lender.')
  })
})
