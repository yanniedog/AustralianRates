/**
 * Trigger retention run on production (POST /admin/retention/run).
 * Requires ADMIN_API_TOKEN in repo root .env when run via runner.
 */
import { buildAdminHeaders, resolveAdminToken, resolveEnvOrigin } from './lib/admin-api'

const ORIGIN = resolveEnvOrigin(['ADMIN_DB_STATS_ORIGIN'])
const url = `${ORIGIN}/api/home-loan-rates/admin/retention/run`
const token = resolveAdminToken(['ADMIN_API_TOKEN', 'ADMIN_API_TOKENS'])

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment. Set it in repo root .env.')
    process.exit(1)
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: buildAdminHeaders(token, '*/*', { 'Content-Type': 'application/json' }),
  })
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  if (!res.ok) {
    console.error('HTTP', res.status, data)
    process.exit(1)
  }
  console.log(data.message || 'Retention run completed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
