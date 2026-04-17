/**
 * Cross-dataset audit of product categorisation / classification quality.
 *
 * For the latest collection_date in each dataset (home loans, savings,
 * term deposits), counts products whose canonical classification fields are
 * missing, empty, or outside the allowed enum. Also surfaces the known
 * `lvr_unspecified` tier for home loans so the inherent data-coverage gap
 * (CDR products that do not publish an LVR band) shows up as an actionable
 * triage item instead of silently flowing through the ingest pipeline.
 *
 * Output shape mirrors coverage-gap-audit: persisted in `app_config`, cached
 * in memory for status-debug bundles, and emitted as an actionable log entry
 * with code `product_classification_gaps` when any issue is found.
 */
import crypto from 'node:crypto'
import { getAppConfig, setAppConfig } from '../db/app-config'
import {
  FEATURE_SETS,
  INTEREST_PAYMENTS,
  LVR_TIERS,
  RATE_STRUCTURES,
  REPAYMENT_TYPES,
  SAVINGS_ACCOUNT_TYPES,
  SAVINGS_RATE_TYPES,
  SECURITY_PURPOSES,
} from '../constants'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

export const PRODUCT_CLASSIFICATION_REPORT_KEY = 'product_classification_last_report_json'

export type ProductClassificationIssueKind =
  | 'lvr_unspecified'
  | 'invalid_enum'
  | 'null_required'
  | 'low_confidence'

export type ProductClassificationIssueBucket = {
  dataset: 'home_loans' | 'savings' | 'term_deposits'
  field: string
  kind: ProductClassificationIssueKind
  count: number
  sample: Array<{
    bank_name: string
    product_id: string
    product_name: string | null
    value: string | null
    confidence_score: number | null
  }>
}

export type ProductClassificationAuditReport = {
  run_id: string
  generated_at: string
  collection_dates: {
    home_loans: string | null
    savings: string | null
    term_deposits: string | null
  }
  totals: {
    issues: number
    affected_products: number
    lvr_unspecified: number
    invalid_enum: number
    null_required: number
    low_confidence: number
  }
  ok: boolean
  buckets: ProductClassificationIssueBucket[]
}

let cachedReport: ProductClassificationAuditReport | null = null

function parseReport(raw: string | null): ProductClassificationAuditReport | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ProductClassificationAuditReport
  } catch {
    return null
  }
}

export async function loadProductClassificationAuditReport(
  db: D1Database,
): Promise<ProductClassificationAuditReport | null> {
  const raw = await getAppConfig(db, PRODUCT_CLASSIFICATION_REPORT_KEY)
  const parsed = parseReport(raw)
  cachedReport = parsed
  return parsed
}

export function getCachedProductClassificationAuditReport(): ProductClassificationAuditReport | null {
  return cachedReport
}

async function latestCollectionDate(
  db: D1Database,
  table: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT MAX(collection_date) AS latest FROM ${table}`)
    .first<{ latest: string | null }>()
  return row?.latest ?? null
}

/** Quote a string literal safely for inline SQL; uses SQLite doubled-quote escaping. */
function sqlLit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

const SAMPLE_LIMIT = 10
const LOW_CONFIDENCE_THRESHOLD = 0.5

type DatasetRule = {
  dataset: ProductClassificationIssueBucket['dataset']
  table: string
  field: string
  enumValues: readonly string[] | null
  allowNull?: boolean
}

const HOME_LOAN_RULES: DatasetRule[] = [
  { dataset: 'home_loans', table: 'historical_loan_rates', field: 'security_purpose', enumValues: SECURITY_PURPOSES },
  { dataset: 'home_loans', table: 'historical_loan_rates', field: 'repayment_type', enumValues: REPAYMENT_TYPES },
  { dataset: 'home_loans', table: 'historical_loan_rates', field: 'rate_structure', enumValues: RATE_STRUCTURES },
  { dataset: 'home_loans', table: 'historical_loan_rates', field: 'lvr_tier', enumValues: LVR_TIERS },
  { dataset: 'home_loans', table: 'historical_loan_rates', field: 'feature_set', enumValues: FEATURE_SETS },
]

const SAVINGS_RULES: DatasetRule[] = [
  { dataset: 'savings', table: 'historical_savings_rates', field: 'account_type', enumValues: SAVINGS_ACCOUNT_TYPES },
  { dataset: 'savings', table: 'historical_savings_rates', field: 'rate_type', enumValues: SAVINGS_RATE_TYPES },
]

const TD_RULES: DatasetRule[] = [
  { dataset: 'term_deposits', table: 'historical_term_deposit_rates', field: 'interest_payment', enumValues: INTEREST_PAYMENTS },
  { dataset: 'term_deposits', table: 'historical_term_deposit_rates', field: 'term_months', enumValues: null },
]

async function auditNullRequired(
  db: D1Database,
  rule: DatasetRule,
  collectionDate: string,
): Promise<ProductClassificationIssueBucket | null> {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${rule.table}
       WHERE collection_date = ?
         AND (${rule.field} IS NULL OR TRIM(CAST(${rule.field} AS TEXT)) = '')`,
    )
    .bind(collectionDate)
    .first<{ c: number }>()
  const count = Number(countRow?.c || 0)
  if (!count) return null
  const sampleRows = await db
    .prepare(
      `SELECT bank_name, product_id, product_name, ${rule.field} AS value, confidence_score
       FROM ${rule.table}
       WHERE collection_date = ?
         AND (${rule.field} IS NULL OR TRIM(CAST(${rule.field} AS TEXT)) = '')
       LIMIT ?`,
    )
    .bind(collectionDate, SAMPLE_LIMIT)
    .all<{ bank_name: string; product_id: string; product_name: string | null; value: string | null; confidence_score: number | null }>()
  return {
    dataset: rule.dataset,
    field: rule.field,
    kind: 'null_required',
    count,
    sample: (sampleRows.results || []).map((r) => ({
      bank_name: String(r.bank_name || ''),
      product_id: String(r.product_id || ''),
      product_name: r.product_name,
      value: r.value == null ? null : String(r.value),
      confidence_score: r.confidence_score == null ? null : Number(r.confidence_score),
    })),
  }
}

async function auditInvalidEnum(
  db: D1Database,
  rule: DatasetRule,
  collectionDate: string,
): Promise<ProductClassificationIssueBucket | null> {
  if (!rule.enumValues || rule.enumValues.length === 0) return null
  const inList = rule.enumValues.map(sqlLit).join(', ')
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${rule.table}
       WHERE collection_date = ?
         AND ${rule.field} IS NOT NULL
         AND TRIM(CAST(${rule.field} AS TEXT)) <> ''
         AND ${rule.field} NOT IN (${inList})`,
    )
    .bind(collectionDate)
    .first<{ c: number }>()
  const count = Number(countRow?.c || 0)
  if (!count) return null
  const sampleRows = await db
    .prepare(
      `SELECT bank_name, product_id, product_name, ${rule.field} AS value, confidence_score
       FROM ${rule.table}
       WHERE collection_date = ?
         AND ${rule.field} IS NOT NULL
         AND TRIM(CAST(${rule.field} AS TEXT)) <> ''
         AND ${rule.field} NOT IN (${inList})
       LIMIT ?`,
    )
    .bind(collectionDate, SAMPLE_LIMIT)
    .all<{ bank_name: string; product_id: string; product_name: string | null; value: string | null; confidence_score: number | null }>()
  return {
    dataset: rule.dataset,
    field: rule.field,
    kind: 'invalid_enum',
    count,
    sample: (sampleRows.results || []).map((r) => ({
      bank_name: String(r.bank_name || ''),
      product_id: String(r.product_id || ''),
      product_name: r.product_name,
      value: r.value == null ? null : String(r.value),
      confidence_score: r.confidence_score == null ? null : Number(r.confidence_score),
    })),
  }
}

async function auditLvrUnspecified(
  db: D1Database,
  collectionDate: string,
): Promise<ProductClassificationIssueBucket | null> {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM historical_loan_rates
       WHERE collection_date = ? AND lvr_tier = 'lvr_unspecified'`,
    )
    .bind(collectionDate)
    .first<{ c: number }>()
  const count = Number(countRow?.c || 0)
  if (!count) return null
  const sampleRows = await db
    .prepare(
      `SELECT bank_name, product_id, product_name, lvr_tier AS value, confidence_score
       FROM historical_loan_rates
       WHERE collection_date = ? AND lvr_tier = 'lvr_unspecified'
       LIMIT ?`,
    )
    .bind(collectionDate, SAMPLE_LIMIT)
    .all<{ bank_name: string; product_id: string; product_name: string | null; value: string | null; confidence_score: number | null }>()
  return {
    dataset: 'home_loans',
    field: 'lvr_tier',
    kind: 'lvr_unspecified',
    count,
    sample: (sampleRows.results || []).map((r) => ({
      bank_name: String(r.bank_name || ''),
      product_id: String(r.product_id || ''),
      product_name: r.product_name,
      value: r.value == null ? null : String(r.value),
      confidence_score: r.confidence_score == null ? null : Number(r.confidence_score),
    })),
  }
}

async function auditLowConfidence(
  db: D1Database,
  dataset: ProductClassificationIssueBucket['dataset'],
  table: string,
  collectionDate: string,
): Promise<ProductClassificationIssueBucket | null> {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${table}
       WHERE collection_date = ? AND confidence_score IS NOT NULL AND confidence_score < ?`,
    )
    .bind(collectionDate, LOW_CONFIDENCE_THRESHOLD)
    .first<{ c: number }>()
  const count = Number(countRow?.c || 0)
  if (!count) return null
  const sampleRows = await db
    .prepare(
      `SELECT bank_name, product_id, product_name, CAST(confidence_score AS TEXT) AS value, confidence_score
       FROM ${table}
       WHERE collection_date = ? AND confidence_score IS NOT NULL AND confidence_score < ?
       ORDER BY confidence_score ASC
       LIMIT ?`,
    )
    .bind(collectionDate, LOW_CONFIDENCE_THRESHOLD, SAMPLE_LIMIT)
    .all<{ bank_name: string; product_id: string; product_name: string | null; value: string | null; confidence_score: number | null }>()
  return {
    dataset,
    field: 'confidence_score',
    kind: 'low_confidence',
    count,
    sample: (sampleRows.results || []).map((r) => ({
      bank_name: String(r.bank_name || ''),
      product_id: String(r.product_id || ''),
      product_name: r.product_name,
      value: r.value == null ? null : String(r.value),
      confidence_score: r.confidence_score == null ? null : Number(r.confidence_score),
    })),
  }
}

async function auditRules(
  db: D1Database,
  rules: DatasetRule[],
  collectionDate: string,
): Promise<ProductClassificationIssueBucket[]> {
  const buckets: ProductClassificationIssueBucket[] = []
  for (const rule of rules) {
    const nullBucket = await auditNullRequired(db, rule, collectionDate)
    if (nullBucket) buckets.push(nullBucket)
    const enumBucket = await auditInvalidEnum(db, rule, collectionDate)
    if (enumBucket) buckets.push(enumBucket)
  }
  return buckets
}

export async function runProductClassificationAudit(
  env: EnvBindings,
  input: { persist?: boolean } = {},
): Promise<ProductClassificationAuditReport> {
  const generatedAt = new Date().toISOString()
  const [homeLoanDate, savingsDate, tdDate] = await Promise.all([
    latestCollectionDate(env.DB, 'historical_loan_rates'),
    latestCollectionDate(env.DB, 'historical_savings_rates'),
    latestCollectionDate(env.DB, 'historical_term_deposit_rates'),
  ])

  const buckets: ProductClassificationIssueBucket[] = []

  if (homeLoanDate) {
    buckets.push(...(await auditRules(env.DB, HOME_LOAN_RULES, homeLoanDate)))
    const lvrBucket = await auditLvrUnspecified(env.DB, homeLoanDate)
    if (lvrBucket) buckets.push(lvrBucket)
    const lowConf = await auditLowConfidence(env.DB, 'home_loans', 'historical_loan_rates', homeLoanDate)
    if (lowConf) buckets.push(lowConf)
  }
  if (savingsDate) {
    buckets.push(...(await auditRules(env.DB, SAVINGS_RULES, savingsDate)))
    const lowConf = await auditLowConfidence(env.DB, 'savings', 'historical_savings_rates', savingsDate)
    if (lowConf) buckets.push(lowConf)
  }
  if (tdDate) {
    buckets.push(...(await auditRules(env.DB, TD_RULES, tdDate)))
    const lowConf = await auditLowConfidence(env.DB, 'term_deposits', 'historical_term_deposit_rates', tdDate)
    if (lowConf) buckets.push(lowConf)
  }

  buckets.sort((a, b) => {
    if (a.dataset !== b.dataset) return a.dataset.localeCompare(b.dataset)
    if (a.field !== b.field) return a.field.localeCompare(b.field)
    return a.kind.localeCompare(b.kind)
  })

  const totals = buckets.reduce(
    (acc, bucket) => {
      acc.issues += 1
      acc.affected_products += bucket.count
      acc[bucket.kind] += bucket.count
      return acc
    },
    {
      issues: 0,
      affected_products: 0,
      lvr_unspecified: 0,
      invalid_enum: 0,
      null_required: 0,
      low_confidence: 0,
    },
  )

  const report: ProductClassificationAuditReport = {
    run_id: `product-classification-audit:${generatedAt}:${crypto.randomUUID()}`,
    generated_at: generatedAt,
    collection_dates: {
      home_loans: homeLoanDate,
      savings: savingsDate,
      term_deposits: tdDate,
    },
    totals,
    ok: totals.issues === 0,
    buckets,
  }

  cachedReport = report
  if (input.persist !== false) {
    try {
      await setAppConfig(env.DB, PRODUCT_CLASSIFICATION_REPORT_KEY, JSON.stringify(report))
    } catch (err) {
      log.warn('scheduler', 'product_classification_audit_persist_failed', {
        code: 'product_classification_persist_failed',
        context: (err as Error)?.message || String(err),
      })
    }
  }

  if (report.ok) {
    log.info('scheduler', 'product_classification_audit_ok', {
      context: JSON.stringify({
        home_loans_date: homeLoanDate,
        savings_date: savingsDate,
        term_deposits_date: tdDate,
      }),
    })
  } else {
    log.error('scheduler', 'product_classification_gaps_detected', {
      code: 'product_classification_gaps',
      context: JSON.stringify({
        home_loans_date: homeLoanDate,
        savings_date: savingsDate,
        term_deposits_date: tdDate,
        totals,
        buckets: buckets.map((b) => ({
          dataset: b.dataset,
          field: b.field,
          kind: b.kind,
          count: b.count,
          sample_bank_names: Array.from(new Set(b.sample.slice(0, 5).map((s) => s.bank_name))),
        })),
      }),
    })
  }

  return report
}

/**
 * Drop stale product_classification_gaps_detected log rows from actionable
 * triage once the latest persisted audit reports ok. Log rows themselves
 * are untouched.
 */
export function shouldFilterProductClassificationLogForActionable(
  entry: Record<string, unknown>,
  report: ProductClassificationAuditReport | null,
): boolean {
  if (!report?.ok) return false
  const msg = String(entry.message || '').trim().toLowerCase()
  if (msg !== 'product_classification_gaps_detected') return false
  const ts = String(entry.ts || '')
  const gen = report.generated_at
  if (!ts || !gen) return false
  return ts < gen
}
