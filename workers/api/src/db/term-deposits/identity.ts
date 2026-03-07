export function tdProductKeySql(alias: string): string {
  return `${alias}.bank_name || '|' || ${alias}.product_id || '|' || CAST(${alias}.term_months AS TEXT) || '|' || ${alias}.deposit_tier || '|' || ${alias}.interest_payment`
}

export function tdSeriesKeySql(alias: string): string {
  return `COALESCE(NULLIF(TRIM(${alias}.series_key), ''), ${tdProductKeySql(alias)})`
}
