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

function isHistoricalNoSignalNoise(entry: Record<string, unknown>, source: string, message: string): boolean {
  if (source !== 'consumer') return false
  const context = normalizeValue(entry.context)
  if (message === 'historical_task_execute completed') {
    return context.includes('completion=warn_no_writes') && context.includes('signals(wayback=0,final=0)')
  }
  if (message === 'historical_task_execute empty_result') {
    return context.includes('had_wayback_signals=0') || context.includes('signals(wayback=0,final=0)')
  }
  return false
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
  if (isHistoricalNoSignalNoise(entry, source, message)) {
    return true
  }
  return lenderCode === 'ubank' && source === 'consumer' && KNOWN_UBANK_NOISE_MESSAGES.has(message)
}
