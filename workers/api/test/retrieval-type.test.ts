import { describe, expect, it } from 'vitest'
import { deriveRetrievalType } from '../src/utils/retrieval-type'

describe('deriveRetrievalType', () => {
  it('marks wayback content as historical', () => {
    expect(deriveRetrievalType('parsed_from_wayback_strict', 'https://example.com')).toBe('historical_scrape')
    expect(deriveRetrievalType('cdr_live', 'https://web.archive.org/web/20200101000000/https://example.com')).toBe('historical_scrape')
  })

  it('marks non-wayback content as present scrape on date', () => {
    expect(deriveRetrievalType('cdr_live', 'https://api.bank.example/products')).toBe('present_scrape_same_date')
  })
})
