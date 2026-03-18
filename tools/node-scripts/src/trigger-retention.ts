/**
 * Trigger retention run on production (POST /admin/retention/run).
 * Requires ADMIN_API_TOKEN in repo root .env when run via runner.
 */
const ORIGIN =
  process.env.ADMIN_DB_STATS_ORIGIN?.trim() || 'https://www.australianrates.com'
const url = `${ORIGIN}/api/home-loan-rates/admin/retention/run`
const token = (
  process.env.ADMIN_API_TOKEN ||
  process.env.ADMIN_API_TOKENS?.split(',')[0]?.trim() ||
  ''
).trim()

async function main(): Promise<void> {
  if (!token) {
    console.error('Missing ADMIN_API_TOKEN in environment. Set it in repo root .env.')
    process.exit(1)
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
