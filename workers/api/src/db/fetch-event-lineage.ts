export function missingFetchEventLineageClause(alias = 'rates'): string {
  return `${alias}.fetch_event_id IS NULL`
}

export function unresolvedFetchEventLineageClause(alias = 'rates', lookupAlias = 'fetch_event_lineage'): string {
  return `${alias}.fetch_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM fetch_events ${lookupAlias}
    WHERE ${lookupAlias}.id = ${alias}.fetch_event_id
  )`
}

export function repairableFetchEventLineageClause(alias = 'rates', lookupAlias = 'fetch_event_lineage'): string {
  return `(${missingFetchEventLineageClause(alias)} OR ${unresolvedFetchEventLineageClause(alias, lookupAlias)})`
}
