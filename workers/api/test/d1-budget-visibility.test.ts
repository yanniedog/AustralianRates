import { describe, expect, it } from 'vitest'
import { buildD1BudgetVisibilitySnapshot } from '../src/utils/d1-budget'
import type { EnvBindings } from '../src/types'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function kvWithUsage(usage: Record<string, unknown>): KVNamespace {
  return {
    get: async (key: string) => (key === `d1-budget:${today()}` ? JSON.stringify(usage) : null),
    put: async () => undefined,
  } as unknown as KVNamespace
}

describe('buildD1BudgetVisibilitySnapshot', () => {
  it('exposes writes_today and reads_today from today’s KV usage row', async () => {
    const env = {
      IDEMPOTENCY_KV: kvWithUsage({
        reads: 42,
        writes: 7,
        updated_at: '2026-05-06T00:00:00.000Z',
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
      IDEMPOTENCY_KV: kvWithUsage({ reads: 0, writes: 0, updated_at: '2026-05-06T00:00:00.000Z' }),
      D1_EMERGENCY_MINIMUM_WRITES: '1',
    } as unknown as EnvBindings
    const snap = await buildD1BudgetVisibilitySnapshot(env)
    expect(snap.emergency_minimum_writes).toBe(true)
  })
})
