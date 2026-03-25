#!/usr/bin/env node
const origin = process.env.API_BASE ? new URL(process.env.API_BASE).origin : 'https://www.australianrates.com'
const u = `${origin}/api/home-loan-rates/rates?page=1&size=50&source_mode=all`
const res = await fetch(u)
const j = await res.json()
const rows = j.rows || j.data || []
const ubank = rows.filter((x) => String(x.bank_name || x.bankName || '').toLowerCase().includes('ubank'))
console.log('rates_ubank_rows', ubank.length, 'of', rows.length, 'total', j.total)
