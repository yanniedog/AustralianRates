import { describe, expect, it } from 'vitest'
import {
  missingFetchEventLineageClause,
  repairableFetchEventLineageClause,
  unresolvedFetchEventLineageClause,
} from '../src/db/fetch-event-lineage'

describe('fetch-event lineage SQL helpers', () => {
  it('builds a missing-lineage predicate for the provided alias', () => {
    expect(missingFetchEventLineageClause('rows')).toBe('rows.fetch_event_id IS NULL')
  })

  it('builds an unresolved-lineage predicate against fetch_events', () => {
    const clause = unresolvedFetchEventLineageClause('rows', 'lineage_lookup')
    expect(clause).toContain('rows.fetch_event_id IS NOT NULL')
    expect(clause).toContain('FROM fetch_events lineage_lookup')
    expect(clause).toContain('lineage_lookup.id = rows.fetch_event_id')
  })

  it('combines missing and unresolved lineage into one repairable predicate', () => {
    const clause = repairableFetchEventLineageClause('rows', 'lineage_lookup')
    expect(clause).toContain(missingFetchEventLineageClause('rows'))
    expect(clause).toContain(unresolvedFetchEventLineageClause('rows', 'lineage_lookup'))
    expect(clause.startsWith('(')).toBe(true)
    expect(clause.endsWith(')')).toBe(true)
  })
})
