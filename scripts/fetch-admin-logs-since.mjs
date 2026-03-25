#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
function loadEnv() {
  const p = path.join(repoRoot, '.env')
  if (!fs.existsSync(p)) return {}
  const out = {}
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}
const env = { ...loadEnv(), ...process.env }
const token = (env.ADMIN_API_TOKEN || '').trim()
const since = process.argv[2] || ''
const needle = process.argv[3] || ''
const source = process.argv[4] || ''
const limit = process.argv[5] || '2000'
if (!token) {
  console.error('Missing ADMIN_API_TOKEN')
  process.exit(1)
}
const origin = process.env.API_BASE ? new URL(process.env.API_BASE).origin : 'https://www.australianrates.com'
const u = new URL(`${origin}/api/home-loan-rates/admin/logs/system`)
u.searchParams.set('format', 'jsonl')
u.searchParams.set('limit', String(Math.min(10000, Math.max(1, parseInt(limit, 10) || 2000))))
if (since) u.searchParams.set('since', since)
if (source) u.searchParams.set('source', source)
const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
const text = await res.text()
if (!res.ok) {
  console.error('HTTP', res.status, text.slice(0, 500))
  process.exit(1)
}
for (const line of text.split('\n')) {
  if (!line.trim()) continue
  if (!needle || line.includes(needle)) console.log(line)
}
