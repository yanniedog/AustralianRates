import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvBindings } from '../src/types'

const mocks = vi.hoisted(() => ({
  handleScheduledDaily: vi.fn(),
  handleScheduledHourlyWayback: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))

vi.mock('../src/pipeline/scheduled', () => ({
  handleScheduledDaily: mocks.handleScheduledDaily,
}))

vi.mock('../src/pipeline/hourly-wayback', () => ({
  handleScheduledHourlyWayback: mocks.handleScheduledHourlyWayback,
}))

vi.mock('../src/utils/logger', () => ({
  log: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
  },
}))

import { dispatchScheduledEvent } from '../src/pipeline/scheduler-dispatch'

function makeEnv(): EnvBindings {
  return {
    DB: {} as D1Database,
    RAW_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue<never>,
    RUN_LOCK_DO: {} as DurableObjectNamespace,
  }
}

describe('scheduler dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handleScheduledDaily.mockResolvedValue({ ok: true, source: 'daily' })
    mocks.handleScheduledHourlyWayback.mockResolvedValue({ ok: true, source: 'hourly' })
  })

  it('dispatches hourly cron to hourly coverage handler', async () => {
    const result = await dispatchScheduledEvent(
      { scheduledTime: Date.parse('2026-02-24T10:00:00.000Z'), cron: '0 * * * *' } as ScheduledController & { cron: string },
      makeEnv(),
    )

    expect(mocks.handleScheduledHourlyWayback).toHaveBeenCalledTimes(1)
    expect(mocks.handleScheduledDaily).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, source: 'hourly' })
  })

  it('dispatches daily cron to daily handler', async () => {
    const result = await dispatchScheduledEvent(
      { scheduledTime: Date.parse('2026-02-24T12:05:00.000Z'), cron: '5 * * * *' } as ScheduledController & { cron: string },
      makeEnv(),
    )

    expect(mocks.handleScheduledDaily).toHaveBeenCalledTimes(1)
    expect(mocks.handleScheduledHourlyWayback).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, source: 'daily' })
  })

  it('skips unknown cron expressions', async () => {
    const result = await dispatchScheduledEvent(
      { scheduledTime: Date.parse('2026-02-24T12:10:00.000Z'), cron: '10 * * * *' } as ScheduledController & { cron: string },
      makeEnv(),
    )

    expect(mocks.handleScheduledDaily).not.toHaveBeenCalled()
    expect(mocks.handleScheduledHourlyWayback).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: 'unknown_cron_expression',
      cron: '10 * * * *',
    })
  })
})
