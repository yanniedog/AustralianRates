import { getAppConfig } from '../db/app-config'
import type { EnvBindings } from '../types'
import type { ProbeCapturePolicy } from './probe-capture'

export const PROBE_SUCCESS_CAPTURE_UNTIL_KEY = 'probe_success_capture_until'

function isFutureIso(value: string | null): boolean {
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

export async function resolveProbeCapturePolicy(
  env: EnvBindings,
  triggerSource: 'scheduled' | 'manual',
): Promise<ProbeCapturePolicy> {
  if (triggerSource === 'manual') {
    return 'always'
  }
  const fullCaptureUntil = await getAppConfig(env.DB, PROBE_SUCCESS_CAPTURE_UNTIL_KEY).catch(() => null)
  return isFutureIso(fullCaptureUntil) ? 'always' : 'sample_success'
}
