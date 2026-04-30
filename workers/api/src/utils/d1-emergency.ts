import type { EnvBindings } from '../types'

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export function isD1EmergencyMinimumWrites(env: Pick<EnvBindings, 'D1_EMERGENCY_MINIMUM_WRITES'>): boolean {
  return truthy(env.D1_EMERGENCY_MINIMUM_WRITES)
}

export function shouldSkipRoutineRawPayload(
  env: Pick<EnvBindings, 'D1_EMERGENCY_MINIMUM_WRITES'>,
  input: { sourceType?: string | null; httpStatus?: number | null; notes?: string | null },
): boolean {
  if (!isD1EmergencyMinimumWrites(env)) return false
  const status = input.httpStatus == null ? 200 : Number(input.httpStatus)
  const successful = Number.isFinite(status) && status >= 200 && status < 400
  if (!successful) return false
  const notes = String(input.notes || '').toLowerCase()
  if (notes.includes('reason=') || notes.includes('upstream_blocks=')) return false
  return input.sourceType === 'cdr_products' || input.sourceType === 'wayback_html'
}
