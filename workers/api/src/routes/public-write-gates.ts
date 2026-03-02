import type { Context } from 'hono'
import type { AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'

function isEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

type GuardConfig = {
  enabled: boolean
  code: string
  message: string
}

function guardWrite(c: Context, config: GuardConfig): Response | null {
  if (config.enabled) return null
  withNoStore(c)
  return jsonError(c, 404, config.code, config.message)
}

export function guardPublicTriggerRun(c: Context<AppContext>): Response | null {
  return guardWrite(c, {
    enabled: isEnabled(c.env.FEATURE_PUBLIC_TRIGGER_RUN_ENABLED),
    code: 'PUBLIC_TRIGGER_RUN_DISABLED',
    message: 'Public trigger-run is disabled in this environment.',
  })
}

export function guardPublicHistoricalPull(c: Context<AppContext>): Response | null {
  return guardWrite(c, {
    enabled: isEnabled(c.env.FEATURE_PUBLIC_HISTORICAL_PULL_ENABLED),
    code: 'PUBLIC_HISTORICAL_PULL_DISABLED',
    message: 'Public historical pull is disabled in this environment.',
  })
}

export function guardPublicExportJob(c: Context<AppContext>): Response | null {
  return guardWrite(c, {
    enabled: isEnabled(c.env.FEATURE_PUBLIC_EXPORT_JOB_ENABLED),
    code: 'PUBLIC_EXPORT_JOB_DISABLED',
    message: 'Public export job creation is disabled in this environment.',
  })
}
