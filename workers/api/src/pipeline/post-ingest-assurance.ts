import type { DatasetKind } from '../../../../packages/shared/src'
import { TARGET_LENDERS } from '../constants'
import { getAppConfig, setAppConfig } from '../db/app-config'
import { listCoverageGapRows } from '../db/lender-dataset-status'
import { buildSnapshotKvKey, type SnapshotScope } from '../db/snapshot-cache'
import type { EnvBindings } from '../types'
import { defaultPublicChartWindowForSection } from '../utils/chart-window'
import { log } from '../utils/logger'

export const POST_INGEST_ASSURANCE_REPORT_KEY = 'post_ingest_assurance_last_report_json'

const DATASETS: DatasetKind[] = ['home_loans', 'savings', 'term_deposits']

type PackageScope = {
  section: DatasetKind
  scope: SnapshotScope
}

const PUBLIC_PACKAGE_SCOPES: PackageScope[] = [
  {
    section: 'home_loans',
    scope: `preset:consumer-default:window:${defaultPublicChartWindowForSection('home_loans')}`,
  },
  { section: 'home_loans', scope: `window:${defaultPublicChartWindowForSection('home_loans')}` },
  {
    section: 'savings',
    scope: `preset:consumer-default:window:${defaultPublicChartWindowForSection('savings')}`,
  },
  { section: 'savings', scope: `window:${defaultPublicChartWindowForSection('savings')}` },
  { section: 'term_deposits', scope: `window:${defaultPublicChartWindowForSection('term_deposits')}` },
]

type DatasetRowCount = {
  dataset: DatasetKind
  historical_table: string
  latest_collection_date: string | null
  latest_row_count: number
}

type FailedLenderScope = {
  lender_code: string
  bank_name: string
  collection_date: string
  datasets: DatasetKind[]
  reasons: string[]
}

type HardFailure = FailedLenderScope & {
  endpoint: string | null
  http_status: number | null
  cdr_version_tried: string
  next_action: string
}

type PackageFreshness = {
  section: DatasetKind
  scope: SnapshotScope
  ok: boolean
  source: 'kv' | 'missing'
  built_at: string | null
}

export type PostIngestAssuranceReport = {
  run_id: string
  generated_at: string
  collection_date: string | null
  ok: boolean
  totals: {
    dataset_row_count_total: number
    failed_lender_scopes: number
    hard_fail_lenders: number
    product_key_mismatches: number
    raw_linkage_gaps: number
    package_freshness_failures: number
  }
  datasets: DatasetRowCount[]
  failed_scopes: FailedLenderScope[]
  hard_failures: HardFailure[]
  integrity: {
    product_key_mismatches: number
    raw_linkage_gaps: number
  }
  packages: PackageFreshness[]
}

function parseReport(raw: string | null): PostIngestAssuranceReport | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as PostIngestAssuranceReport
  } catch {
    return null
  }
}

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .bind(table)
    .first<{ ok: number }>()
  return row?.ok === 1
}

async function latestCollectionDate(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(collection_date) AS latest
       FROM lender_dataset_runs`,
    )
    .first<{ latest: string | null }>()
  return row?.latest ?? null
}

async function countLatestRows(
  db: D1Database,
  dataset: DatasetKind,
  table: string,
  collectionDate: string | null,
): Promise<DatasetRowCount> {
  if (!collectionDate || !(await tableExists(db, table))) {
    return { dataset, historical_table: table, latest_collection_date: null, latest_row_count: 0 }
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE collection_date = ?`)
    .bind(collectionDate)
    .first<{ count: number }>()
  return {
    dataset,
    historical_table: table,
    latest_collection_date: collectionDate,
    latest_row_count: Number(row?.count ?? 0),
  }
}

async function productKeyMismatchCount(db: D1Database, collectionDate: string | null): Promise<number> {
  if (!collectionDate) return 0
  const checks = [
    {
      table: 'historical_loan_rates',
      expression:
        "bank_name || '|' || product_id || '|' || security_purpose || '|' || repayment_type || '|' || lvr_tier || '|' || rate_structure",
    },
    {
      table: 'historical_savings_rates',
      expression: "bank_name || '|' || product_id || '|' || account_type || '|' || rate_type || '|' || deposit_tier",
    },
    {
      table: 'historical_term_deposit_rates',
      expression:
        "bank_name || '|' || product_id || '|' || CAST(term_months AS TEXT) || '|' || deposit_tier || '|' || interest_payment",
    },
  ]
  let total = 0
  for (const check of checks) {
    if (!(await tableExists(db, check.table))) continue
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${check.table}
         WHERE collection_date = ?
           AND (series_key IS NULL OR TRIM(series_key) = '' OR series_key != ${check.expression})`,
      )
      .bind(collectionDate)
      .first<{ count: number }>()
    total += Number(row?.count ?? 0)
  }
  return total
}

async function rawLinkageGapCount(db: D1Database, collectionDate: string | null): Promise<number> {
  if (!collectionDate || !(await tableExists(db, 'fetch_events')) || !(await tableExists(db, 'raw_objects'))) {
    return 0
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM fetch_events fe
       LEFT JOIN raw_objects ro
         ON ro.content_hash = fe.content_hash
       WHERE fe.collection_date = ?
         AND ro.content_hash IS NULL`,
    )
    .bind(collectionDate)
    .first<{ count: number }>()
  return Number(row?.count ?? 0)
}

function asDataset(value: string): DatasetKind | null {
  return value === 'home_loans' || value === 'savings' || value === 'term_deposits' ? value : null
}

function groupFailedScopes(rows: Awaited<ReturnType<typeof listCoverageGapRows>>): FailedLenderScope[] {
  const grouped = new Map<string, FailedLenderScope>()
  for (const row of rows) {
    if (row.severity !== 'error') continue
    const dataset = asDataset(String(row.dataset_kind))
    if (!dataset) continue
    const key = `${row.collection_date}|${row.lender_code}`
    const scope =
      grouped.get(key) ??
      {
        lender_code: row.lender_code,
        bank_name: row.bank_name,
        collection_date: row.collection_date,
        datasets: [],
        reasons: [],
      }
    if (!scope.datasets.includes(dataset)) scope.datasets.push(dataset)
    for (const reason of row.reasons) {
      if (!scope.reasons.includes(reason)) scope.reasons.push(reason)
    }
    grouped.set(key, scope)
  }
  return Array.from(grouped.values()).map((scope) => ({
    ...scope,
    datasets: DATASETS.filter((dataset) => scope.datasets.includes(dataset)),
    reasons: scope.reasons.sort((a, b) => a.localeCompare(b)),
  }))
}

function lenderEndpoint(lenderCode: string): string | null {
  const lender = TARGET_LENDERS.find((entry) => entry.code === lenderCode)
  return lender?.products_endpoint ?? lender?.additional_products_endpoints?.[0] ?? null
}

function hardFailures(scopes: FailedLenderScope[]): HardFailure[] {
  return scopes
    .filter(
      (scope) =>
        DATASETS.every((dataset) => scope.datasets.includes(dataset)) &&
        scope.reasons.includes('index_fetch_not_succeeded'),
    )
    .map((scope) => ({
      ...scope,
      endpoint: lenderEndpoint(scope.lender_code),
      http_status: null,
      cdr_version_tried: '[6,5,4,3]',
      next_action: `Run targeted daily ingest for lender ${scope.lender_code} on ${scope.collection_date}, then rebuild public packages.`,
    }))
}

async function packageFreshness(env: EnvBindings): Promise<PackageFreshness[]> {
  if (!env.CHART_CACHE_KV) {
    return PUBLIC_PACKAGE_SCOPES.map((item) => ({
      ...item,
      ok: false,
      source: 'missing',
      built_at: null,
    }))
  }
  const results: PackageFreshness[] = []
  for (const item of PUBLIC_PACKAGE_SCOPES) {
    const raw = await env.CHART_CACHE_KV.get(buildSnapshotKvKey(item.section, item.scope))
    let builtAt: string | null = null
    if (raw) {
      try {
        builtAt = String((JSON.parse(raw) as { builtAt?: string }).builtAt ?? '') || null
      } catch {
        builtAt = null
      }
    }
    results.push({
      ...item,
      ok: Boolean(raw && builtAt),
      source: raw ? 'kv' : 'missing',
      built_at: builtAt,
    })
  }
  return results
}

export async function loadPostIngestAssuranceReport(db: D1Database): Promise<PostIngestAssuranceReport | null> {
  return parseReport(await getAppConfig(db, POST_INGEST_ASSURANCE_REPORT_KEY))
}

export async function runPostIngestAssurance(
  env: EnvBindings,
  input: { collectionDate?: string; persist?: boolean; emitHardFailureLog?: boolean } = {},
): Promise<PostIngestAssuranceReport> {
  const generatedAt = new Date().toISOString()
  const collectionDate = input.collectionDate ?? (await latestCollectionDate(env.DB))
  const [datasets, gaps, productKeyMismatches, rawLinkageGaps, packages] = await Promise.all([
    Promise.all([
      countLatestRows(env.DB, 'home_loans', 'historical_loan_rates', collectionDate),
      countLatestRows(env.DB, 'savings', 'historical_savings_rates', collectionDate),
      countLatestRows(env.DB, 'term_deposits', 'historical_term_deposit_rates', collectionDate),
    ]),
    collectionDate ? listCoverageGapRows(env.DB, { collectionDate, limit: 500 }) : Promise.resolve([]),
    productKeyMismatchCount(env.DB, collectionDate),
    rawLinkageGapCount(env.DB, collectionDate),
    packageFreshness(env),
  ])
  const failedScopes = groupFailedScopes(gaps)
  const hard = hardFailures(failedScopes)
  const packageFailures = packages.filter((item) => !item.ok).length

  const report: PostIngestAssuranceReport = {
    run_id: `post-ingest-assurance:${generatedAt}:${crypto.randomUUID()}`,
    generated_at: generatedAt,
    collection_date: collectionDate,
    ok:
      failedScopes.length === 0 &&
      hard.length === 0 &&
      productKeyMismatches === 0 &&
      rawLinkageGaps === 0 &&
      packageFailures === 0,
    totals: {
      dataset_row_count_total: datasets.reduce((sum, item) => sum + item.latest_row_count, 0),
      failed_lender_scopes: failedScopes.length,
      hard_fail_lenders: hard.length,
      product_key_mismatches: productKeyMismatches,
      raw_linkage_gaps: rawLinkageGaps,
      package_freshness_failures: packageFailures,
    },
    datasets,
    failed_scopes: failedScopes.slice(0, 50),
    hard_failures: hard,
    integrity: {
      product_key_mismatches: productKeyMismatches,
      raw_linkage_gaps: rawLinkageGaps,
    },
    packages,
  }

  if (input.persist !== false) {
    await setAppConfig(env.DB, POST_INGEST_ASSURANCE_REPORT_KEY, JSON.stringify(report))
  }

  if (hard.length > 0 && input.emitHardFailureLog !== false) {
    log.error('scheduler', 'post_ingest_assurance_hard_failure', {
      code: 'post_ingest_assurance_failed',
      context: JSON.stringify({
        collection_date: collectionDate,
        hard_fail_lenders: hard.length,
        sample: hard.slice(0, 3),
      }),
    })
  }

  return report
}
