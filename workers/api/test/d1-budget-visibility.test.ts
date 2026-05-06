import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildD1BudgetVisibilitySnapshot } from '../src/utils/d1-budget'
import type { EnvBindings } from '../src/types'

const FIXED_YMD = '2099-06-15'

function kvWithUsage(usage: Record<string, unknown>): KVNamespace {
  return {
    get: async (key: string) => (key === `d1-budget:${FIXED_YMD}` ? JSON.stringify(usage) : null),
    put: async () => undefined,
  } as unknown as KVNamespace
}

describe('buildD1BudgetVisibilitySnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${FIXED_YMD}T12:00:00.000Z`))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes writes_today and reads_today from today’s KV usage row', async () => {
    const env = {
      IDEMPOTENCY_KV: kvWithUsage({
        reads: 42,
        writes: 7,
        updated_at: '2099-06-15T00:00:00.000Z',
      }),
      D1_DAILY_READ_LIMIT: '100',
      D1_DAILY_WRITE_LIMIT: '50',
      D1_NONESSENTIAL_DISABLE_FRACTION: '0.8',
    } as unknown as EnvBindings

    const snap = await buildD1BudgetVisibilitySnapshot(env)
    expect(snap.reads_today).toBe(42)
    expect(snap.writes_today).toBe(7)
    expect(snap.daily_read_limit).toBe(100)
    expect(snap.daily_write_limit).toBe(50)
    expect(snap.nonessential_disable_fraction).toBe(0.8)
    expect(snap.emergency_minimum_writes).toBe(false)
    expect(snap.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('reflects emergency minimum writes env flag', async () => {
    const env = {
      IDEMPOTENCY_KV: kvWithUsage({ reads: 0, writes: 0, updated_at: '2099-06-15T00:00:00.000Z' }),
      D1_EMERGENCY_MINIMUM_WRITES: '1',
    } as unknown as EnvBindings
    const snap = await buildD1BudgetVisibilitySnapshot(env)
    expect(snap.emergency_minimum_writes).toBe(true)
  })
})
