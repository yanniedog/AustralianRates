import { gunzipSync } from 'node:zlib'
import { env } from 'cloudflare:test'

function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inLineComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (inLineComment) {
      if (char === '\n') inLineComment = false
      continue
    }

    if (!inSingleQuote && char === '-' && next === '-') {
      inLineComment = true
      index += 1
      continue
    }

    current += char

    if (char === "'") {
      if (inSingleQuote && next === "'") {
        current += next
        index += 1
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === ';' && !inSingleQuote) {
      const statement = current.trim()
      if (statement) statements.push(statement)
      current = ''
    }
  }

  const trailing = current.trim()
  if (trailing) statements.push(trailing)
  return statements
}

async function executeInBatches(statements: string[], batchSize = 200): Promise<void> {
  for (let index = 0; index < statements.length; index += batchSize) {
    await env.DB.exec(statements.slice(index, index + batchSize).join('\n'))
  }
}

export async function resetHistoricalQualityFixtureTables(): Promise<void> {
  const tables = [
    'historical_quality_findings',
    'historical_quality_daily',
    'historical_quality_runs',
    'historical_provenance_recovery_runs',
    'historical_provenance_status',
    'lender_dataset_runs',
    'historical_term_deposit_rates',
    'historical_savings_rates',
    'historical_loan_rates',
    'fetch_events',
    'raw_objects',
    'series_presence_status',
    'product_presence_status',
    'series_catalog',
    'product_catalog',
    'rba_cash_rates',
  ]
  for (const table of tables) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

function decodeBase64(base64: string): Uint8Array {
  const decoded = atob(base64)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

export async function loadHistoricalQualityFixture(gzipBase64: string): Promise<void> {
  const sql = gunzipSync(decodeBase64(gzipBase64)).toString('utf8')
  await executeInBatches(splitStatements(sql))
}
