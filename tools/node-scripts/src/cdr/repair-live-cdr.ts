import { configuredLenderCodes, fetchLiveCdrSummary, readAdminToken, type DatasetKind } from './live-cdr'

function parseArgs(args: string[]): {
  lenderCodes: string[]
  collectionDate: string
  baseUrl: string
  datasets?: DatasetKind[]
  continueOnError: boolean
} {
  const lenderCodes: string[] = []
  let collectionDate = new Date().toISOString().slice(0, 10)
  let baseUrl = 'https://www.australianrates.com'
  let datasets: DatasetKind[] | undefined
  let continueOnError = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if ((arg === '--lender' || arg === '--lender-code') && args[i + 1]) {
      lenderCodes.push(args[i + 1])
      i += 1
      continue
    }
    if (arg === '--all') {
      lenderCodes.push(...configuredLenderCodes())
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
    if (arg === '--datasets' && args[i + 1]) {
      datasets = args[i + 1]
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is DatasetKind => value === 'home_loans' || value === 'savings' || value === 'term_deposits')
      i += 1
      continue
    }
    if (arg === '--continue-on-error') {
      continueOnError = true
    }
  }

  if (lenderCodes.length === 0) throw new Error('Missing required --lender-code <code> or --all')
  return {
    lenderCodes: Array.from(new Set(lenderCodes)),
    collectionDate,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    datasets,
    continueOnError,
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!response.ok) throw new Error(`http_${response.status}:${url}:${text}`)
  return json
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const token = readAdminToken()
  if (!token) throw new Error('Missing ADMIN_API_TOKEN or ADMIN_TEST_TOKEN in environment/.env')

  const results: unknown[] = []
  let failed = false

  for (const lenderCode of args.lenderCodes) {
    try {
      const live = await fetchLiveCdrSummary({
        lenderCode,
        collectionDate: args.collectionDate,
        datasets: args.datasets,
      })

      const totalRows =
        live.rows.home_loans.length +
        live.rows.savings.length +
        live.rows.term_deposits.length
      if (totalRows === 0) {
        results.push({
          lender_code: lenderCode,
          collection_date: args.collectionDate,
          product_counts: live.product_counts,
          row_counts: {
            home_loans: live.rows.home_loans.length,
            savings: live.rows.savings.length,
            term_deposits: live.rows.term_deposits.length,
          },
          skipped: 'no_live_cdr_rows',
        })
        continue
      }

      const result = await requestJson(`${args.baseUrl}/api/home-loan-rates/admin/repairs/live-cdr-import`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          lender_code: lenderCode,
          collection_date: args.collectionDate,
          rows: live.rows,
        }),
      })

      results.push({
        lender_code: lenderCode,
        collection_date: args.collectionDate,
        product_counts: live.product_counts,
        row_counts: {
          home_loans: live.rows.home_loans.length,
          savings: live.rows.savings.length,
          term_deposits: live.rows.term_deposits.length,
        },
        import_result: result,
      })
    } catch (error) {
      failed = true
      const message = (error as Error).message || String(error)
      results.push({
        lender_code: lenderCode,
        collection_date: args.collectionDate,
        error: message,
      })
      if (!args.continueOnError) {
        process.stdout.write(JSON.stringify(results, null, 2))
        process.stdout.write('\n')
        process.exitCode = 1
        return
      }
    }
  }

  process.stdout.write(JSON.stringify(results, null, 2))
  process.stdout.write('\n')
  if (failed) process.exitCode = 1
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exitCode = 1
})
