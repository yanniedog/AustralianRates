import type { IngestPauseMode } from '../types'

const KNOWN_UBANK_NOISE_MESSAGES = new Set([
  'daily_lender_fetch upstream_block_detected',
  'daily_savings_lender_fetch upstream_block_detected',
  'daily_savings_lender_fetch empty_result',
])

function normalizeValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function shouldIgnoreStatusActionableLog(
  entry: Record<string, unknown>,
  pauseMode: IngestPauseMode,
): boolean {
  if (pauseMode !== 'repair_pause' && normalizeValue(entry.code) === 'ingest_paused') {
    return true
  }

  const message = normalizeValue(entry.message)
  const lenderCode = normalizeValue(entry.lender_code ?? entry.lenderCode)
  const source = normalizeValue(entry.source)
  return lenderCode === 'ubank' && source === 'consumer' && KNOWN_UBANK_NOISE_MESSAGES.has(message)
}
