import type { IngestPauseMode } from '../types'

const KNOWN_UBANK_NOISE_MESSAGES = new Set([
  'daily_lender_fetch upstream_block_detected',
  'daily_savings_lender_fetch upstream_block_detected',
  'daily_savings_lender_fetch empty_result',
])
const KNOWN_ADMIN_STATUS_DUPLICATE_MESSAGES = new Set(['cdr_audit_detected_gaps'])

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function shouldIgnoreStatusActionableLog(
  entry: Record<string, unknown>,
  pauseMode: IngestPauseMode,
): boolean {
  const source = normalizeValue(entry.source)
  const message = normalizeValue(entry.message)

  if (pauseMode !== 'repair_pause' && normalizeValue(entry.code) === 'ingest_paused') {
    return true
  }

  const lenderCode = normalizeValue(entry.lender_code ?? entry.lenderCode)
  if (source === 'admin' && KNOWN_ADMIN_STATUS_DUPLICATE_MESSAGES.has(message)) {
    return true
  }
  return lenderCode === 'ubank' && source === 'consumer' && KNOWN_UBANK_NOISE_MESSAGES.has(message)
}
