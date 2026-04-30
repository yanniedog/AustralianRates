#!/usr/bin/env node
/**
 * Full census: production AR /latest (mode=daily) vs bank seed pages + live CDR product detail.
 * Uses https://www.australianrates.com only. Reads workers/api/config/lenders.json for CDR URLs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORIGIN = 'https://www.australianrates.com'
const LENDERS_PATH = join(__dirname, 'workers', 'api', 'config', 'lenders.json')
/** AMP publishes variable rates via this public JSON (same source as ingest). */
const AMP_MORTGAGE_VARIABLES_URL = 'https://www.amp.com.au/graphql/execute.json/amp-2024/variables'

const EXCLUDED_RATE_TYPES = new Set([
  'DISCOUNT',
  'BUNDLE_DISCOUNT',
  'INTRODUCTORY',
  'PENALTY',
  'CASH_ADVANCE',
  'PURCHASE',
])

const RATE_STRUCTURES = ['variable', 'fixed_1yr', 'fixed_2yr', 'fixed_3yr', 'fixed_4yr', 'fixed_5yr']

function loadLenders() {
  const raw = JSON.parse(readFileSync(LENDERS_PATH, 'utf8'))
  const byBank = new Map()
  for (const L of raw.lenders || []) {
    byBank.set(L.canonical_bank_name, L)
  }
  return { list: raw.lenders || [], byBank }
}

function parseNum(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

function pickText(obj, keys) {
  for (const k of keys) {
    const t = obj[k]
    if (t != null && String(t).trim()) return String(t).trim()
  }
  return ''
}

function extractRatesArray(detail) {
  for (const key of ['lendingRates', 'rates', 'rateTiers', 'rate']) {
    const arr = asArray(detail[key]).filter((x) => x && typeof x === 'object')
    if (arr.length) return arr
  }
  return []
}

function interestFromRateObj(rate) {
  const raw = rate.rate ?? rate.interestRate ?? rate.value
  let n = parseNum(raw)
  if (n == null) return null
  /** CDR often encodes percent as decimal fraction (e.g. 0.0649 == 6.49%). */
  if (n > 0 && n < 1) n *= 100
  return n
}

function unwrapProductDetailPayload(body) {
  if (!body || typeof body !== 'object') return body
  if (typeof body.code === 'string' && body.message && !body.productId && !body.name && !body.data) {
    return null
  }
  const inner = body.data
  if (inner && typeof inner === 'object' && (inner.productId != null || inner.name != null || inner.lendingRates != null)) {
    return inner
  }
  return body
}

function isSuccessfulProductDetail(data) {
  const d = unwrapProductDetailPayload(data)
  if (!d || typeof d !== 'object') return false
  return Boolean(pickText(d, ['productId', 'id']) || extractRatesArray(d).length)
}

function lvrKeywordsFromTier(tier) {
  const t = String(tier || '').toLowerCase()
  if (t === 'lvr_unspecified') return []
  if (t === 'lvr_=60%') return ['60', '<=', 'lvr']
  const m = t.match(/^lvr_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/)
  if (m) return [m[1], m[2], 'lvr']
  return [t]
}

function repaymentKeywords(rt) {
  const r = String(rt || '').toLowerCase()
  if (r === 'principal_and_interest') return ['principal', 'interest', 'p&i', 'p and i', 'repayment']
  if (r === 'interest_only') return ['interest only', 'interest-only', 'io']
  return [r]
}

function purposeKeywords(sp) {
  const s = String(sp || '').toLowerCase()
  if (s === 'owner_occupied') return ['owner', 'occupied', 'oo']
  if (s === 'investment') return ['investment', 'investor']
  return [s]
}

function rateStructureKeywords(rs) {
  const s = String(rs || '').toLowerCase()
  if (s === 'variable') return ['variable', 'var']
  const f = s.match(/^fixed_(\d+)yr$/)
  if (f) return ['fixed', f[1], `${f[1]} year`, `${f[1]}yr`]
  return [s]
}

function scoreRateAgainstRow(rate, row) {
  const blob = JSON.stringify(rate).toLowerCase()
  let score = 0
  for (const k of lvrKeywordsFromTier(row.lvr_tier)) {
    if (k && blob.includes(k)) score += 2
  }
  for (const k of repaymentKeywords(row.repayment_type)) {
    if (k && blob.includes(k)) score += 2
  }
  for (const k of purposeKeywords(row.security_purpose)) {
    if (k && blob.includes(k)) score += 1
  }
  for (const k of rateStructureKeywords(row.rate_structure)) {
    if (k && blob.includes(k)) score += 2
  }
  const lt = pickText(rate, ['lendingRateType']).toUpperCase()
  if (lt && EXCLUDED_RATE_TYPES.has(lt)) return -999
  return score
}

function findBestCdrRateMatch(detail, row) {
  const root = unwrapProductDetailPayload(detail) || detail
  const rates = extractRatesArray(root)
  const target = parseNum(row.interest_rate)
  if (target == null) return { matched: false, reason: 'no_ar_rate' }
  const cmpTarget = parseNum(row.comparison_rate)

  let best = null
  for (const rate of rates) {
    const ir = interestFromRateObj(rate)
    if (ir == null) continue
    if (Math.abs(ir - target) > 0.011) continue
    const sc = scoreRateAgainstRow(rate, row)
    if (sc < 0) continue
    let cmp = parseNum(rate.comparisonRate ?? rate.comparison ?? rate.comparison_value)
    if (cmp != null && cmp > 0 && cmp < 1) cmp *= 100
    let cmpBonus = 0
    if (cmpTarget != null && cmp != null && Math.abs(cmp - cmpTarget) <= 0.02) cmpBonus = 3
    const total = sc + cmpBonus
    if (!best || total > best.total) {
      best = { total, rate, ir, cmp }
    }
  }
  if (best) return { matched: true, ...best }
  /** Fallback: same headline only (any tier) */
  for (const rate of rates) {
    const ir = interestFromRateObj(rate)
    if (ir == null) continue
    const lt = pickText(rate, ['lendingRateType']).toUpperCase()
    if (lt && EXCLUDED_RATE_TYPES.has(lt)) continue
    if (Math.abs(ir - target) <= 0.011) {
      let c2 = parseNum(rate.comparisonRate ?? rate.comparison ?? rate.comparison_value)
      if (c2 != null && c2 > 0 && c2 < 1) c2 *= 100
      return { matched: true, fallbackHeadlineOnly: true, rate, ir, cmp: c2 }
    }
  }
  return { matched: false, reason: 'no_lending_rate_matches_headline' }
}

async function fetchCdrJson(url) {
  const versions = [6, 5, 4, 3]
  for (const xV of versions) {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-v': String(xV),
        'x-min-v': '1',
      },
    })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      continue
    }
    const hasErr =
      (Array.isArray(data?.errors) && data.errors.length > 0) ||
      (typeof data?.errorCode === 'string' && data.errorCode.trim()) ||
      (typeof data?.errorMessage === 'string' && data.errorMessage.trim()) ||
      (typeof data?.code === 'string' &&
        typeof data?.message === 'string' &&
        !unwrapProductDetailPayload(data))
    if (res.ok && data && !hasErr && isSuccessfulProductDetail(data)) {
      return { ok: true, data, status: res.status, xV, url }
    }
    if (res.status === 406) continue
    if (res.status === 404) return { ok: false, status: 404, text: text.slice(0, 500), url, xV }
  }
  return { ok: false, status: 0, text: 'no_version_ok', url }
}

async function fetchProductDetail(lender, productId) {
  const base = String(lender.products_endpoint || '').replace(/\/$/, '')
  const primary = `${base}/${encodeURIComponent(productId)}`
  let r = await fetchCdrJson(primary)
  if (r.ok) return { ...r, endpointTried: 'primary' }
  const extras = lender.additional_products_endpoints || []
  for (const ex of extras) {
    const b = String(ex).replace(/\/$/, '')
    const u = `${b}/${encodeURIComponent(productId)}`
    r = await fetchCdrJson(u)
    if (r.ok) return { ...r, endpointTried: 'additional', url: u }
  }
  return { ...r, endpointTried: 'primary' }
}

function rateStringsForHtml(arRate) {
  const n = Number(arRate)
  if (!Number.isFinite(n)) return []
  const out = new Set()
  out.add(String(n))
  out.add(n.toFixed(2))
  out.add(n.toFixed(3))
  out.add(`${n.toFixed(2)}%`)
  out.add(`${n.toFixed(3)}%`)
  if (n === Math.floor(n)) out.add(`${Math.floor(n)}.00%`)
  return [...out]
}

function htmlContainsArRate(html, arRate) {
  if (!html) return false
  const lower = html.toLowerCase().replace(/\s+/g, ' ')
  for (const s of rateStringsForHtml(arRate)) {
    if (lower.includes(s.toLowerCase())) return true
  }
  return false
}

/** Seed page shows a rate within 0.08%p but not the exact same digit string (rounded / marketing table). */
function htmlRoundedNearRate(html, arRate) {
  const n = Number(arRate)
  if (!Number.isFinite(n) || !html) return false
  const re = /\b(\d{1,2}\.\d{1,4})\s*%/gi
  let m
  while ((m = re.exec(html))) {
    const v = Number(m[1])
    if (Number.isFinite(v) && Math.abs(v - n) > 0.001 && Math.abs(v - n) <= 0.08) return true
  }
  return false
}

let ampVariablesCache = null
async function getAmpVariablePlaintextMap() {
  if (!ampVariablesCache) {
    const res = await fetch(AMP_MORTGAGE_VARIABLES_URL, {
      headers: { accept: 'application/json', 'user-agent': 'AustralianRates-census-verify/1.0 (+https://www.australianrates.com)' },
    })
    const j = await res.json().catch(() => ({}))
    const m = new Map()
    const items = j?.data?.variableList?.items || []
    for (const item of items) {
      const key = typeof item?.key === 'string' ? item.key.trim() : ''
      const plain = typeof item?.value?.plaintext === 'string' ? item.value.plaintext.replace(/\s+/g, ' ').trim() : ''
      if (key && plain) m.set(key, plain)
    }
    ampVariablesCache = { ok: res.ok, status: res.status, map: m }
  }
  return ampVariablesCache
}

function matchAmpFromVariables(map, productId, interestTarget) {
  const base = String(productId).replace(/^amp-variable-/, '')
  const raw = map.get(`${base}_interest`)
  if (raw == null) return { matched: false, reason: 'no_interest_key', base }
  const cleaned = String(raw).replace(/%/g, '').trim()
  const ir = parseNum(cleaned)
  if (ir == null) return { matched: false, reason: 'unparseable_interest', base }
  const target = Number(interestTarget)
  if (!Number.isFinite(target)) return { matched: false, reason: 'bad_target', base }
  if (Math.abs(ir - target) <= 0.02) return { matched: true, base, observed: ir }
  return { matched: false, reason: 'interest_mismatch', base, observed: ir }
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url, timeoutMs = 25000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'AustralianRates-census-verify/1.0 (+https://www.australianrates.com)' },
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    return { ok: false, status: 0, text: String(e?.message || e) }
  } finally {
    clearTimeout(t)
  }
}

async function latestQuery(params) {
  const u = new URL(`${ORIGIN}/api/home-loan-rates/latest`)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v))
  }
  const res = await fetch(u.toString())
  if (!res.ok) throw new Error(`latest ${res.status} ${u}`)
  return res.json()
}

async function buildCensusRows() {
  const baseParams = {
    mode: 'daily',
    source_mode: 'all',
    limit: 1000,
    exclude_compare_edge_cases: 0,
  }
  const first = await latestQuery(baseParams)
  if (!first.ok) throw new Error(`latest not ok: ${JSON.stringify(first).slice(0, 200)}`)
  const total = Number(first.total ?? 0)
  const filtersRes = await fetch(`${ORIGIN}/api/home-loan-rates/filters`).then((r) => {
    if (!r.ok) throw new Error(`filters ${r.status}`)
    return r.json()
  })
  const banks = filtersRes.filters?.banks || filtersRes.banks || []
  const bySeries = new Map()

  for (const bank of banks) {
    const j = await latestQuery({ ...baseParams, bank })
    for (const row of j.rows || []) {
      bySeries.set(row.series_key, row)
    }
    const limited = j.meta?.limited
    const count = j.rows?.length ?? 0
    if (limited && count >= 1000) {
      for (const rs of RATE_STRUCTURES) {
        const j2 = await latestQuery({ ...baseParams, bank, rate_structure: rs })
        for (const row of j2.rows || []) {
          bySeries.set(row.series_key, row)
        }
        if (j2.meta?.limited && (j2.rows?.length ?? 0) >= 1000) {
          throw new Error(`Still limited for bank=${bank} rate_structure=${rs}; add more partitions.`)
        }
      }
    }
  }

  if (bySeries.size !== total) {
    throw new Error(`Census count mismatch: union=${bySeries.size} total=${total}`)
  }
  return { rows: [...bySeries.values()], total, banks }
}

function csvEscape(s) {
  const t = String(s ?? '')
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`
  return t
}

function rowToCsvLine(obj, keys) {
  return keys.map((k) => csvEscape(obj[k] ?? '')).join(',')
}

async function main() {
  const { byBank, list: lendersList } = loadLenders()
  process.stderr.write('Fetching census from production...\n')
  const { rows, total } = await buildCensusRows()
  process.stderr.write(`Census rows: ${rows.length} (total=${total})\n`)

  const cdrCache = new Map()
  const seedHtmlCache = new Map()

  const keys = [
    'series_key',
    'bank_name',
    'product_id',
    'product_name',
    'security_purpose',
    'repayment_type',
    'rate_structure',
    'lvr_tier',
    'interest_rate',
    'comparison_rate',
    'collection_date',
    'source_url',
    'product_url',
    'seed_rate_url',
    'html_fetch_ok',
    'html_seed_contains_ar_rate',
    'html_rounded_near_match',
    'html_seed_text_sample',
    'cdr_fetch_ok',
    'cdr_detail_url',
    'cdr_match',
    'cdr_match_note',
    'observed_bank_rate',
    'evidence',
    'status',
    'notes',
  ]

  const outRows = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (i % 50 === 0) process.stderr.write(`Processing ${i + 1}/${rows.length}...\n`)

    const lender = byBank.get(row.bank_name)
    const seedUrls = lender?.seed_rate_urls || []
    const seed_rate_url = seedUrls[0] || ''

    let html_fetch_ok = ''
    let html_seed_contains_ar_rate = ''
    let html_seed_text_sample = ''
    if (seed_rate_url) {
      if (!seedHtmlCache.has(seed_rate_url)) {
        const r = await fetchText(seed_rate_url)
        seedHtmlCache.set(seed_rate_url, r)
        await new Promise((r) => setTimeout(r, 120))
      }
      const hr = seedHtmlCache.get(seed_rate_url)
      html_fetch_ok = hr.ok ? '1' : '0'
      const plain = stripTags(hr.text).slice(0, 8000)
      html_seed_text_sample = plain.slice(0, 240).replace(/,/g, ';')
      html_seed_contains_ar_rate = htmlContainsArRate(hr.text, row.interest_rate) ? '1' : '0'
    } else {
      html_fetch_ok = 'na'
      html_seed_contains_ar_rate = 'na'
    }

    const seedHtmlBody = seed_rate_url && seedHtmlCache.has(seed_rate_url) ? seedHtmlCache.get(seed_rate_url).text || '' : ''
    const html_rounded_near_match = seedHtmlBody && htmlRoundedNearRate(seedHtmlBody, row.interest_rate) ? '1' : '0'

    const pid = String(row.product_id || '').trim()
    let cdr_fetch_ok = '0'
    let cdr_detail_url = ''
    let cdr_match = '0'
    let cdr_match_note = ''
    let observed_bank_rate = 'not_autodetected'
    let evidence = ''
    let status = ''
    let notes = ''

    if (!lender) {
      status = 'ar_error'
      notes = 'no_lender_config_for_bank_name'
      observed_bank_rate = 'na'
      evidence = seed_rate_url || ''
    } else if (!pid) {
      status = 'ar_error'
      notes = 'missing_product_id'
    } else {
      let regulatoryMatch = false

      if (lender.code === 'amp') {
        cdr_detail_url = AMP_MORTGAGE_VARIABLES_URL
        const ampPack = await getAmpVariablePlaintextMap()
        if (!ampPack.ok) {
          cdr_fetch_ok = '0'
          cdr_match = '0'
          cdr_match_note = `amp_variables_fetch_fail status=${ampPack.status}`
          status = 'ar_error'
          notes = 'amp_graphql_unavailable'
          evidence = AMP_MORTGAGE_VARIABLES_URL
        } else {
          cdr_fetch_ok = '1'
          const am = matchAmpFromVariables(ampPack.map, pid, row.interest_rate)
          regulatoryMatch = Boolean(am.matched)
          cdr_match = am.matched ? '1' : '0'
          cdr_match_note = am.matched ? 'amp_graphql_variables' : String(am.reason || 'amp_no_match')
          if (am.matched && am.observed != null) observed_bank_rate = String(am.observed)
        }
      } else {
        const cacheKey = `${row.bank_name}|${pid}`
        let detailRes = cdrCache.get(cacheKey)
        if (!detailRes) {
          detailRes = await fetchProductDetail(lender, pid)
          cdrCache.set(cacheKey, detailRes)
          await new Promise((r) => setTimeout(r, 80))
        }
        cdr_detail_url = detailRes.url || ''
        if (!detailRes.ok) {
          cdr_fetch_ok = '0'
          cdr_match = '0'
          cdr_match_note = `cdr_fetch_fail status=${detailRes.status}`
          status = 'ar_error'
          notes = String(detailRes.text || '').slice(0, 200)
          evidence = cdr_detail_url
        } else {
          cdr_fetch_ok = '1'
          const match = findBestCdrRateMatch(detailRes.data, row)
          regulatoryMatch = Boolean(match.matched)
          cdr_match = match.matched ? '1' : '0'
          cdr_match_note = match.matched
            ? match.fallbackHeadlineOnly
              ? 'headline_only_fallback'
              : 'dimension_scored'
            : match.reason || 'no_match'
        }
      }

      const htmlExact = html_seed_contains_ar_rate === '1'
      const htmlRound = html_rounded_near_match === '1'

      /** UBank daily ingest may align headline to seed HTML while CDR detail shape differs. */
      if (lender.code === 'ubank' && htmlExact) {
        status = 'pass'
        observed_bank_rate = String(row.interest_rate)
        evidence = [seed_rate_url, cdr_detail_url].filter(Boolean).join(' | ')
        notes = 'ubank_headline_matches_seed_html_cdr_detail_unverified'
      } else if (lender.code === 'amp' && cdr_fetch_ok === '1') {
        if (regulatoryMatch && htmlExact) {
          status = 'pass'
          if (observed_bank_rate === 'not_autodetected') observed_bank_rate = String(row.interest_rate)
          evidence = [seed_rate_url, AMP_MORTGAGE_VARIABLES_URL].filter(Boolean).join(' | ')
          notes = ''
        } else if (regulatoryMatch && !htmlExact && htmlRound) {
          status = 'presentation'
          evidence = [seed_rate_url, AMP_MORTGAGE_VARIABLES_URL].filter(Boolean).join(' | ')
          notes = 'regulatory_matches_seed_rounded_or_adjacent'
        } else if (regulatoryMatch && !htmlExact) {
          status = 'cdr_only_match'
          evidence = AMP_MORTGAGE_VARIABLES_URL
          notes = 'regulatory_matches_dynamic_or_sparse_seed_html'
        } else {
          status = 'ar_error'
          evidence = AMP_MORTGAGE_VARIABLES_URL
          notes = `amp_variable_mismatch pid=${pid}`
        }
      } else if (lender.code !== 'amp' && cdr_fetch_ok === '1') {
        if (regulatoryMatch && htmlExact) {
          status = 'pass'
          observed_bank_rate = String(row.interest_rate)
          evidence = [seed_rate_url, cdr_detail_url].filter(Boolean).join(' | ')
          notes = cdr_match_note === 'headline_only_fallback' ? 'cdr_headline_only_html_rate_present' : ''
        } else if (regulatoryMatch && !htmlExact && htmlRound) {
          status = 'presentation'
          evidence = [seed_rate_url, cdr_detail_url].filter(Boolean).join(' | ')
          notes = 'cdr_matches_seed_rounded_or_adjacent_table'
        } else if (regulatoryMatch && !htmlExact) {
          status = 'cdr_only_match'
          evidence = cdr_detail_url
          notes = `seed_page_no_exact_${String(row.interest_rate)}_substring`
        } else {
          status = 'ar_error'
          evidence = cdr_detail_url
          notes = `cdr_no_match_for_headline pid=${pid}`
        }
      }

      if (html_fetch_ok === '0' && seed_rate_url) {
        notes = (notes ? notes + ';' : '') + 'html_seed_fetch_failed'
      }
    }

    outRows.push({
      series_key: row.series_key,
      bank_name: row.bank_name,
      product_id: row.product_id,
      product_name: row.product_name,
      security_purpose: row.security_purpose,
      repayment_type: row.repayment_type,
      rate_structure: row.rate_structure,
      lvr_tier: row.lvr_tier,
      interest_rate: row.interest_rate,
      comparison_rate: row.comparison_rate ?? '',
      collection_date: row.collection_date,
      source_url: row.source_url ?? '',
      product_url: row.product_url ?? '',
      seed_rate_url,
      html_fetch_ok,
      html_seed_contains_ar_rate,
      html_rounded_near_match,
      html_seed_text_sample,
      cdr_fetch_ok,
      cdr_detail_url,
      cdr_match,
      cdr_match_note,
      observed_bank_rate,
      evidence,
      status,
      notes,
    })
  }

  const summary = {
    generated_at: new Date().toISOString(),
    origin: ORIGIN,
    total_rows: outRows.length,
    by_status: {},
    lenders_configured: lendersList.length,
    timing: 'not_automated_effective_dates_require_manual_bank_page_review',
    status_taxonomy: ['pass', 'presentation', 'cdr_only_match', 'ar_error', 'timing'],
  }
  for (const r of outRows) {
    summary.by_status[r.status] = (summary.by_status[r.status] || 0) + 1
  }

  const csvPath = join(__dirname, 'mortgage-rate-census-audit.csv')
  const jsonPath = join(__dirname, 'mortgage-rate-census-audit.meta.json')
  const lines = [keys.join(','), ...outRows.map((o) => rowToCsvLine(o, keys))]
  writeFileSync(csvPath, lines.join('\n'), 'utf8')
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8')

  process.stderr.write(`Wrote ${csvPath}\nWrote ${jsonPath}\nSummary: ${JSON.stringify(summary.by_status)}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
