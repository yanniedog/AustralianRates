import { configuredLenderCodes, fetchLiveCdrSummary, readAdminToken, type DatasetKind } from './live-cdr'
import { homeLoanSeriesKey, savingsSeriesKey, tdSeriesKey } from '../../../../workers/api/src/utils/series-identity'

type PublicRow = { series_key?: string | null }

function parseArgs(args: string[]): {
  lenderCodes: string[]
  collectionDate: string
  baseUrl: string
  cacheBust: boolean
  useAdminAuth: boolean
} {
  let lenderCodes = configuredLenderCodes()
  let collectionDate = new Date().toISOString().slice(0, 10)
  let baseUrl = 'https://www.australianrates.com'
  let cacheBust = false
  let useAdminAuth = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if ((arg === '--lender' || arg === '--lender-code') && args[i + 1]) {
      lenderCodes = [args[i + 1]]
      i += 1
      continue
    }
    if (arg === '--date' && args[i + 1]) {
      collectionDate = args[i + 1]
      i += 1
      continue
    }
    if (arg === '--base-url' && args[i + 1]) {
      baseUrl = args[i + 1]
      i += 1
      continue
    }
    if (arg === '--cache-bust' || arg === '--fresh') {
      cacheBust = true
      continue
    }
    if (arg === '--auth' || arg === '--admin-auth') {
      useAdminAuth = true
    }
  }

  return {
    lenderCodes,
    collectionDate,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    cacheBust,
    useAdminAuth,
  }
}

async function requestRows(url: string, adminToken: string): Promise<PublicRow[]> {
  const response = await fetch(url, {
    headers: adminToken ? { authorization: `Bearer ${adminToken}` } : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`http_${response.status}:${url}:${text}`)
  const json = JSON.parse(text) as { rows?: PublicRow[] }
  return Array.isArray(json.rows) ? json.rows : []
}

function publicBase(dataset: DatasetKind, baseUrl: string): string {
  if (dataset === 'home_loans') return `${baseUrl}/api/home-loan-rates`
  if (dataset === 'savings') return `${baseUrl}/api/savings-rates`
  return `${baseUrl}/api/term-deposit-rates`
}

async function publicSeriesSet(
  baseUrl: string,
  dataset: DatasetKind,
  bankName: string,
  options: { cacheBust: boolean; adminToken: string },
): Promise<Set<string>> {
  const url = new URL(`${publicBase(dataset, baseUrl)}/latest-all`)
  url.searchParams.set('bank', bankName)
  url.searchParams.set('limit', '5000')
  url.searchParams.set('source_mode', 'all')
  url.searchParams.set('include_removed', 'true')
  if (options.cacheBust) {
    url.searchParams.set('cache_bust', '1')
  }
  const rows = await requestRows(url.toString(), options.adminToken)
  return new Set(rows.map((row) => String(row.series_key || '').trim()).filter(Boolean))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const adminToken = args.useAdminAuth ? readAdminToken() : ''
  if (args.useAdminAuth && !adminToken) {
    throw new Error('Missing ADMIN_API_TOKEN or ADMIN_TEST_TOKEN in environment/.env')
  }
  const report: Array<Record<string, unknown>> = []
  let failed = false

  for (const lenderCode of args.lenderCodes) {
    const live = await fetchLiveCdrSummary({
      lenderCode,
      collectionDate: args.collectionDate,
    })
    const bankName = live.lender.canonical_bank_name
    const [homePublic, savingsPublic, tdPublic] = await Promise.all([
      publicSeriesSet(args.baseUrl, 'home_loans', bankName, { cacheBust: args.cacheBust, adminToken }),
      publicSeriesSet(args.baseUrl, 'savings', bankName, { cacheBust: args.cacheBust, adminToken }),
      publicSeriesSet(args.baseUrl, 'term_deposits', bankName, { cacheBust: args.cacheBust, adminToken }),
    ])
    const expectedHome = new Set(live.rows.home_loans.map((row) => homeLoanSeriesKey(row)))
    const expectedSavings = new Set(live.rows.savings.map((row) => savingsSeriesKey(row)))
    const expectedTd = new Set(live.rows.term_deposits.map((row) => tdSeriesKey(row)))

    const compare = (expected: Set<string>, actual: Set<string>) => ({
      expected_count: expected.size,
      public_count: actual.size,
      missing_in_public: Array.from(expected).filter((value) => !actual.has(value)).sort(),
      unexpected_in_public: Array.from(actual).filter((value) => !expected.has(value)).sort(),
    })

    const lenderResult = {
      lender_code: lenderCode,
      bank_name: bankName,
      home_loans: compare(expectedHome, homePublic),
      savings: compare(expectedSavings, savingsPublic),
      term_deposits: compare(expectedTd, tdPublic),
    }
    if (
      lenderResult.home_loans.missing_in_public.length > 0 ||
      lenderResult.savings.missing_in_public.length > 0 ||
      lenderResult.term_deposits.missing_in_public.length > 0
    ) {
      failed = true
    }
    report.push(lenderResult)
  }

  process.stdout.write(JSON.stringify({ collection_date: args.collectionDate, report }, null, 2))
  process.stdout.write('\n')
  if (failed) process.exitCode = 1
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exitCode = 1
})
