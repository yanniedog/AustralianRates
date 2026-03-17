import { TARGET_LENDERS } from '../constants'
import { getAppConfig, setAppConfig } from '../db/app-config'
import { fetchCdrJson, fetchJson } from '../ingest/cdr/http'
import { extractBrands, selectBestMatchingBrand, type RegisterBrand } from '../ingest/cdr/discovery'
import type { EnvBindings } from '../types'
import { log } from '../utils/logger'

const LENDER_UNIVERSE_REPORT_KEY = 'lender_universe_last_report_json'

const REGISTER_URLS = [
  'https://api.cdr.gov.au/cdr-register/v1/all/data-holders/brands/summary',
  'https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands',
  'https://api.cdr.gov.au/cdr-register/v1/banking/register',
]

export type LenderUniverseAuditReport = {
  run_id: string
  generated_at: string
  ok: boolean
  register_source_url: string | null
  register_brand_count: number
  totals: {
    configured_lenders: number
    matched_lenders: number
    missing_from_register: number
    endpoint_drift: number
  }
  rows: Array<{
    lender_code: string
    bank_name: string
    register_brand_name: string
    status: 'ok' | 'missing_from_register' | 'endpoint_drift'
    configured_endpoint: string | null
    register_endpoint: string | null
  }>
  error?: string
}

let cachedReport: LenderUniverseAuditReport | null = null

function parseReport(raw: string | null): LenderUniverseAuditReport | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as LenderUniverseAuditReport
  } catch {
    return null
  }
}

function hostFromUrl(url: string | null | undefined): string {
  try {
    return url ? new URL(url).host.toLowerCase() : ''
  } catch {
    return ''
  }
}

function hostsMatch(configured: string | null, discovered: string | null): boolean {
  const configuredHost = hostFromUrl(configured)
  const discoveredHost = hostFromUrl(discovered)
  if (!configuredHost || !discoveredHost) return configuredHost === discoveredHost
  return (
    configuredHost === discoveredHost ||
    configuredHost.endsWith(`.${discoveredHost}`) ||
    discoveredHost.endsWith(`.${configuredHost}`)
  )
}

async function fetchRegisterBrands(env: EnvBindings): Promise<{ sourceUrl: string; brands: RegisterBrand[] }> {
  for (const registerUrl of REGISTER_URLS) {
    const fetched = registerUrl.includes('/all/data-holders/brands/summary')
      ? await fetchCdrJson(registerUrl, [1, 2, 3, 4, 5, 6], {
          env,
          sourceName: 'lender_universe_audit',
        })
      : await fetchJson(registerUrl, {
          env,
          sourceName: 'lender_universe_audit',
        })
    if (!fetched.ok) continue
    const brands = extractBrands(fetched.data)
    if (brands.length === 0) continue
    return {
      sourceUrl: registerUrl,
      brands,
    }
  }
  throw new Error('lender_universe_register_unavailable')
}

export async function loadLenderUniverseAuditReport(db: D1Database): Promise<LenderUniverseAuditReport | null> {
  const raw = await getAppConfig(db, LENDER_UNIVERSE_REPORT_KEY)
  const parsed = parseReport(raw)
  cachedReport = parsed
  return parsed
}

export function getCachedLenderUniverseAuditReport(): LenderUniverseAuditReport | null {
  return cachedReport
}

export async function runLenderUniverseAudit(
  env: EnvBindings,
  input: { persist?: boolean } = {},
): Promise<LenderUniverseAuditReport> {
  const generatedAt = new Date().toISOString()
  try {
    const fetched = await fetchRegisterBrands(env)
    const rows = TARGET_LENDERS.map((lender) => {
      const hit = selectBestMatchingBrand(lender, fetched.brands)
      if (!hit) {
        return {
          lender_code: lender.code,
          bank_name: lender.canonical_bank_name,
          register_brand_name: lender.register_brand_name,
          status: 'missing_from_register' as const,
          configured_endpoint: lender.products_endpoint || null,
          register_endpoint: null,
        }
      }

      const drift = !hostsMatch(lender.products_endpoint || null, hit.endpointUrl)
      return {
        lender_code: lender.code,
        bank_name: lender.canonical_bank_name,
        register_brand_name: hit.brandName || lender.register_brand_name,
        status: drift ? 'endpoint_drift' as const : 'ok' as const,
        configured_endpoint: lender.products_endpoint || null,
        register_endpoint: hit.endpointUrl,
      }
    })

    const hasEndpointDrift = rows.some((row) => row.status === 'endpoint_drift')
    const missingWithConfiguredEndpoint = rows.filter(
      (row) => row.status === 'missing_from_register' && row.configured_endpoint != null,
    )
    const ok =
      !hasEndpointDrift &&
      rows.every(
        (row) =>
          row.status === 'ok' ||
          (row.status === 'missing_from_register' && row.configured_endpoint != null),
      )
    const report: LenderUniverseAuditReport = {
      run_id: `lender-universe-audit:${generatedAt}:${crypto.randomUUID()}`,
      generated_at: generatedAt,
      ok,
      register_source_url: fetched.sourceUrl,
      register_brand_count: fetched.brands.length,
      totals: {
        configured_lenders: TARGET_LENDERS.length,
        matched_lenders: rows.filter((row) => row.status !== 'missing_from_register').length,
        missing_from_register: rows.filter((row) => row.status === 'missing_from_register').length,
        endpoint_drift: rows.filter((row) => row.status === 'endpoint_drift').length,
      },
      rows,
    }

    cachedReport = report
    if (input.persist !== false) {
      await setAppConfig(env.DB, LENDER_UNIVERSE_REPORT_KEY, JSON.stringify(report))
    }

    const missingWithoutEndpoint = rows.filter(
      (row) => row.status === 'missing_from_register' && row.configured_endpoint == null,
    )
    const shouldError =
      hasEndpointDrift || missingWithoutEndpoint.length > 0

    if (report.ok) {
      log.info('scheduler', 'lender_universe_audit_ok', {
        context: `register_source=${fetched.sourceUrl} configured=${TARGET_LENDERS.length}` +
          (missingWithConfiguredEndpoint.length > 0
            ? ` missing_but_configured=${missingWithConfiguredEndpoint.length}`
            : ''),
      })
    } else if (shouldError) {
      log.error('scheduler', 'lender_universe_audit_detected_drift', {
        code: 'lender_universe_drift',
        context: JSON.stringify({
          register_source: fetched.sourceUrl,
          totals: report.totals,
          sample: report.rows.filter((row) => row.status !== 'ok').slice(0, 5),
        }),
      })
    } else {
      log.info('scheduler', 'lender_universe_audit_missing_but_configured', {
        context: JSON.stringify({
          register_source: fetched.sourceUrl,
          missing_but_configured: missingWithConfiguredEndpoint.length,
          sample: missingWithConfiguredEndpoint.slice(0, 5).map((r) => r.lender_code),
        }),
      })
    }

    return report
  } catch (error) {
    const report: LenderUniverseAuditReport = {
      run_id: `lender-universe-audit:${generatedAt}:${crypto.randomUUID()}`,
      generated_at: generatedAt,
      ok: false,
      register_source_url: null,
      register_brand_count: 0,
      totals: {
        configured_lenders: TARGET_LENDERS.length,
        matched_lenders: 0,
        missing_from_register: TARGET_LENDERS.length,
        endpoint_drift: 0,
      },
      rows: [],
      error: (error as Error)?.message || String(error),
    }
    cachedReport = report
    if (input.persist !== false) {
      await setAppConfig(env.DB, LENDER_UNIVERSE_REPORT_KEY, JSON.stringify(report))
    }
    log.error('scheduler', 'lender_universe_audit_failed', {
      code: 'lender_universe_drift',
      error,
      context: report.error,
    })
    return report
  }
}
