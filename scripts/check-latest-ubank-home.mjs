#!/usr/bin/env node
const origin = process.env.API_BASE ? new URL(process.env.API_BASE).origin : 'https://www.australianrates.com'
const res = await fetch(`${origin}/api/home-loan-rates/latest?limit=800&source_mode=all`)
const j = await res.json()
const rows = j.rows || j.data || []
const u = rows.filter((x) => JSON.stringify(x).toLowerCase().includes('ubank'))
console.log('ubank_rows', u.length)
if (u[0]) console.log(JSON.stringify(u[0]).slice(0, 600))
