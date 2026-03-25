#!/usr/bin/env node
/**
 * POST /admin/runs/reconcile-lender-day (requires ADMIN_API_TOKEN in repo root .env).
 * Usage: node scripts/admin-reconcile-lender-day.mjs <collection_date> <lender_code> [dataset...]
 * Example: node scripts/admin-reconcile-lender-day.mjs 2026-03-25 ubank home_loans
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const envPath = path.join(repoRoot, '.env')
function loadEnv() {
  if (!fs.existsSync(envPath)) return {}
  const out = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}
const env = { ...loadEnv(), ...process.env }
const token = (env.ADMIN_API_TOKEN || env.ADMIN_API_TOKENS?.split(',')[0]?.trim() || '').trim()
if (!token) {
  console.error('Missing ADMIN_API_TOKEN in .env')
  process.exit(1)
}
const collectionDate = process.argv[2]
const lenderCode = process.argv[3]
const rest = process.argv.slice(4)
if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate || '') || !lenderCode) {
  console.error('Usage: node scripts/admin-reconcile-lender-day.mjs YYYY-MM-DD lender_code [dataset ...]')
  process.exit(1)
}
const datasets = rest.length > 0 ? rest : ['home_loans', 'savings', 'term_deposits']
const origin = process.env.API_BASE ? new URL(process.env.API_BASE).origin : 'https://www.australianrates.com'
const url = `${origin}/api/home-loan-rates/admin/runs/reconcile-lender-day`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    collection_date: collectionDate,
    lender_code: lenderCode,
    datasets,
  }),
})
const text = await res.text()
console.log('HTTP', res.status)
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2))
} catch {
  console.log(text.slice(0, 4000))
}
process.exit(res.ok ? 0 : 1)
