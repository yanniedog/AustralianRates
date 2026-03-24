#!/usr/bin/env node
/**
 * Per-product_key interest_rate aggregates for export XLSX analysis.
 */
'use strict'

function medianOfSorted(sorted) {
  const n = sorted.length
  if (n === 0) return null
  const mid = Math.floor(n / 2)
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function quantileSorted(sorted, q) {
  if (sorted.length === 0) return null
  const n = sorted.length
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function round3(x) {
  return Math.round(x * 1000) / 1000
}

function buildBuckets(rows) {
  const byKey = new Map()
  for (const r of rows) {
    const k = r.product_key
    if (k == null || k === '') continue
    const rate = Number(r.interest_rate)
    if (!Number.isFinite(rate)) continue
    let b = byKey.get(k)
    if (!b) {
      b = {
        product_key: k,
        bank_name: r.bank_name,
        product_name: r.product_name,
        rates: [],
      }
      byKey.set(k, b)
    }
    b.rates.push(rate)
  }
  return byKey
}

function finalizeBucket(bucket) {
  const rates = bucket.rates.slice().sort((a, b) => a - b)
  const n = rates.length
  const min = rates[0]
  const max = rates[n - 1]
  const median = medianOfSorted(rates)
  const q1 = quantileSorted(rates, 0.25)
  const q3 = quantileSorted(rates, 0.75)
  return {
    product_key: bucket.product_key,
    bank_name: bucket.bank_name,
    product_name: bucket.product_name,
    n,
    min,
    max,
    median,
    q1,
    q3,
    iqr: q3 - q1,
    spread: max - min,
  }
}

function toSummaryRow(s) {
  return {
    product_key: s.product_key,
    bank_name: s.bank_name,
    product_name: s.product_name,
    n: s.n,
    min: round3(s.min),
    max: round3(s.max),
    median: round3(s.median),
    iqr: round3(s.iqr),
    spread: round3(s.spread),
  }
}

/**
 * @param {object[]} rows
 * @param {{ volatilitySpreadMin?: number, volatilityMinObs?: number, listLimit?: number }} opts
 */
function summarizeProductKeyRates(rows, opts) {
  const volatilitySpreadMin = opts?.volatilitySpreadMin ?? 2
  const volatilityMinObs = opts?.volatilityMinObs ?? 3
  const listLimit = opts?.listLimit ?? 25

  const byKey = buildBuckets(rows)
  const stats = [...byKey.values()].map(finalizeBucket)
  if (stats.length === 0) {
    return {
      distinctKeys: 0,
      medianDistribution: { p2_floor: null, p98_ceiling: null },
      extremeLowMedian: [],
      extremeHighMedian: [],
      highVolatility: [],
      alwaysZeroRate: [],
    }
  }

  const byMed = [...stats].sort((a, b) => a.median - b.median)
  const n = byMed.length
  const idx2 = Math.min(n - 1, Math.max(0, Math.floor(0.02 * (n - 1))))
  const idx98 = Math.min(n - 1, Math.max(0, Math.floor(0.98 * (n - 1))))
  const floor = byMed[idx2].median
  const ceiling = byMed[idx98].median

  const extremeLow = byMed.filter((s) => s.median <= floor).slice(0, listLimit)
  const extremeHigh = byMed
    .filter((s) => s.median >= ceiling)
    .sort((a, b) => b.median - a.median)
    .slice(0, listLimit)

  const highVol = stats
    .filter((s) => s.n >= volatilityMinObs && s.spread >= volatilitySpreadMin)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, listLimit)

  const alwaysZero = stats
    .filter((s) => s.median === 0 && s.max === 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, listLimit)

  return {
    distinctKeys: stats.length,
    medianDistribution: {
      p2_floor: round3(floor),
      p98_ceiling: round3(ceiling),
    },
    extremeLowMedian: extremeLow.map(toSummaryRow),
    extremeHighMedian: extremeHigh.map(toSummaryRow),
    highVolatility: highVol.map(toSummaryRow),
    alwaysZeroRate: alwaysZero.map(toSummaryRow),
  }
}

module.exports = { summarizeProductKeyRates }
