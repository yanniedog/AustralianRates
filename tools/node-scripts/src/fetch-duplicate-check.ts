/**
 * Fetch duplicate-check result from production admin API.
 * Requires ADMIN_API_TOKEN in repo root .env when run via runner.
 */
import { buildAdminHeaders, resolveAdminToken, resolveEnvOrigin } from './lib/admin-api'

const ORIGIN = resolveEnvOrigin(['ADMIN_DB_STATS_ORIGIN'])
const url = `${ORIGIN}/api/home-loan-rates/admin/db/duplicate-check`
const token = resolveAdminToken(['ADMIN_API_TOKEN', 'ADMIN_API_TOKENS'])

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment. Set it in repo root .env.')
    process.exit(1)
  }
  const res = await fetch(url, {
    headers: buildAdminHeaders(token, 'application/json'),
  })
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`)
    process.exit(1)
  }
  const data = (await res.json()) as {
    ok: boolean
    results?: { table: string; total_rows: number; distinct_keys: number; duplicate_rows: number }[]
    one_row_per_day?: boolean
  }
  if (!data.ok || !Array.isArray(data.results)) {
    console.error('Unexpected response:', data)
    process.exit(1)
  }
  console.log('Intra-day duplicate check (one row per product_key per collection_date):')
  for (const r of data.results) {
    console.log(
      `  ${r.table}: total=${r.total_rows.toLocaleString()} distinct_keys=${r.distinct_keys.toLocaleString()} duplicate_rows=${r.duplicate_rows}`,
    )
  }
  console.log('one_row_per_day:', data.one_row_per_day === true ? 'yes' : 'no')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
