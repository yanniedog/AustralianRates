#!/usr/bin/env node
/**
 * Smoke test: UBank public HTML must be fetchable with the same User-Agent as
 * workers/api UBank fallback (Akamai WAF blocks missing or browser-like UAs from many datacenters).
 * Uses real network + real response body shape only (no mock rows).
 */
const UBANK_UA = 'curl/8.18.0'
const URL = 'https://www.ubank.com.au/home-loans/neat-variable-rate-home-loans'

const res = await fetch(URL, {
  headers: { 'User-Agent': UBANK_UA, Accept: '*/*' },
})

const html = await res.text()
if (!res.ok) {
  console.error(`UBank fetch failed: HTTP ${res.status} len=${html.length}`)
  process.exit(1)
}
if (html.length < 50_000) {
  console.error(`UBank HTML unexpectedly small (${html.length} bytes); WAF may be blocking this UA or IP.`)
  process.exit(1)
}
if (!html.includes('tableCaption') || !html.includes('home loan rates')) {
  console.error('UBank HTML missing expected embedded rate table JSON.')
  process.exit(1)
}
console.log(`UBank public HTML OK: ${res.status} ${html.length} bytes`)
