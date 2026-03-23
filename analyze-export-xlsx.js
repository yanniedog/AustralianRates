#!/usr/bin/env node
/**
 * Read-only analysis of site-downloaded *-export.xlsx files in ./exports/
 * Uses vendor SheetJS (buffer read — readFile path not wired in browser bundle).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const XLSX = require('./site/vendor/sheetjs/xlsx.full.min.js')

const EXCEL_MAX_CHARS = 32767
const EXPORTS_DIR = path.join(__dirname, 'exports')

function loadSheet(filePath) {
  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const name = wb.SheetNames[0]
  const sh = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(sh, { defval: null })
  return { wb, sheetName: name, rows, bytes: buf.length }
}

function colLens(rows, col) {
  let max = 0
  let overExcel = 0
  let nonEmpty = 0
  for (const r of rows) {
    const v = r[col]
    if (v == null || v === '') continue
    nonEmpty++
    const s = typeof v === 'string' ? v : String(v)
    const len = s.length
    if (len > max) max = len
    if (len > EXCEL_MAX_CHARS) overExcel++
  }
  return { max, overExcel, nonEmpty }
}

function nullCount(rows, col) {
  let n = 0
  for (const r of rows) {
    const v = r[col]
    if (v == null || v === '') n++
  }
  return n
}

function numericStats(rows, col) {
  const vals = []
  for (const r of rows) {
    const v = r[col]
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) vals.push(n)
  }
  if (vals.length === 0) return { count: 0, min: null, max: null, nonNumeric: rows.length }
  vals.sort((a, b) => a - b)
  return {
    count: vals.length,
    min: vals[0],
    max: vals[vals.length - 1],
    nonNumeric: rows.length - vals.length,
  }
}

function duplicateKeys(rows, keyFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    m.set(k, (m.get(k) || 0) + 1)
  }
  let dups = 0
  let dupRows = 0
  for (const [, c] of m) {
    if (c > 1) {
      dups++
      dupRows += c
    }
  }
  return { uniqueKeys: m.size, duplicateKeyGroups: dups, rowsInDuplicateGroups: dupRows }
}

function analyzeFile(filePath) {
  const base = path.basename(filePath)
  const { rows, bytes, sheetName } = loadSheet(filePath)
  const keys = rows[0] ? Object.keys(rows[0]) : []
  const cdr = keys.includes('cdr_product_detail_json')
    ? colLens(rows, 'cdr_product_detail_json')
    : null

  const report = {
    file: base,
    bytes,
    sheetName,
    rowCount: rows.length,
    columnCount: keys.length,
    columns: keys,
    has_has_offset_account: keys.includes('has_offset_account'),
    has_display_columns: keys.some((k) => k.endsWith('_display')),
    cdr_json: cdr,
    nulls: {
      product_key: nullCount(rows, 'product_key'),
      interest_rate: nullCount(rows, 'interest_rate'),
      bank_name: nullCount(rows, 'bank_name'),
      collection_date: nullCount(rows, 'collection_date'),
    },
    interest_rate: numericStats(rows, 'interest_rate'),
    product_key_dupes: rows.length
      ? duplicateKeys(rows, (r) => `${r.bank_name}|${r.collection_date}|${r.product_key}`)
      : null,
  }

  if (keys.includes('comparison_rate')) {
    const blanks = nullCount(rows, 'comparison_rate')
    report.comparison_rate = numericStats(rows, 'comparison_rate')
    report.comparison_rate.blankRows = blanks
    if (blanks > 0 && keys.includes('data_quality_flag')) {
      const byFlag = {}
      for (const r of rows) {
        if (r.comparison_rate != null && r.comparison_rate !== '') continue
        const f = String(r.data_quality_flag ?? '(null)')
        byFlag[f] = (byFlag[f] || 0) + 1
      }
      report.comparison_rate.blankByDataQualityFlag = byFlag
    }
  }

  report.interest_rate_zero_rows = rows.filter((r) => Number(r.interest_rate) === 0).length

  if (keys.includes('conditions')) {
    report.conditions = colLens(rows, 'conditions')
  }

  return report
}

function main() {
  if (!fs.existsSync(EXPORTS_DIR)) {
    console.error('No exports directory:', EXPORTS_DIR)
    process.exit(1)
  }
  const files = fs
    .readdirSync(EXPORTS_DIR)
    .filter((f) => f.endsWith('.xlsx'))
    .map((f) => path.join(EXPORTS_DIR, f))
  if (files.length === 0) {
    console.error('No .xlsx files in', EXPORTS_DIR)
    process.exit(1)
  }

  console.log(JSON.stringify({ analyzed: files.map((f) => path.basename(f)) }, null, 2))
  for (const f of files) {
    console.log('\n---', path.basename(f), '---')
    const r = analyzeFile(f)
    console.log(JSON.stringify(r, null, 2))
  }
}

main()
