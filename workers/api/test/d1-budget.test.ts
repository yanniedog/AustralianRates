import { describe, expect, it } from 'vitest'
import {
  D1_INCLUDED_MONTHLY_READS,
  D1_INCLUDED_MONTHLY_WRITES,
  D1_READ_OVERAGE_PER_MILLION_USD,
  D1_WRITE_OVERAGE_PER_MILLION_USD,
  computeD1OverageCostUsd,
  isPublicLiveD1FallbackDisabled,
  readLocalD1BudgetState,
} from '../src/utils/d1-budget'
import type { EnvBindings } from '../src/types'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthProjectionInput(targetFraction: number, quota: number): number {
  const now = new Date()
  const elapsedDays = Math.max(1, Number(now.toISOString().slice(8, 10)))
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  return Math.ceil((quota * targetFraction * elapsedDays) / daysInMonth)
}

function kvWithUsage(usage: Record<string, unknown>): KVNamespace {
  return {
    get: async (key: string) => (key === `d1-budget:${today()}` ? JSON.stringify(usage) : null),
    put: async () => undefined,
  } as unknown as KVNamespace
}

function envWithUsage(usage: Record<string, unknown>): EnvBindings {
  return {
    IDEMPOTENCY_KV: kvWithUsage(usage),
  } as unknown as EnvBindings
}

describe('D1 budget guardrails', () => {
  it('prices Cloudflare D1 overage in whole per-million billing units', () => {
    expect(computeD1OverageCostUsd(0, D1_INCLUDED_MONTHLY_WRITES + 7_380_000)).toBe(8)
    expect(computeD1OverageCostUsd(D1_INCLUDED_MONTHLY_READS + 1, 0)).toBe(0.001)
  })

  it('projects local advisory usage and preserves daily CDR protection state', async () => {
    const readOverage = 100_000_000
    const writeOverage = 2_000_000
    const state = await readLocalD1BudgetState(envWithUsage({
      reads: D1_INCLUDED_MONTHLY_READS + readOverage,
      writes: D1_INCLUDED_MONTHLY_WRITES + writeOverage,
      updated_at: '2026-04-24T00:00:00.000Z',
      by_class: {
        critical_coverage: { reads: 12, writes: 3 },
      },
    }), 1)

    expect(state.guardrails.daily_cdr_protected).toBe(true)
    expect(state.days[0].by_class?.critical_coverage).toEqual({ reads: 12, writes: 3 })
    expect(state.days[0].estimated_cost_usd).toBeCloseTo(
      Math.ceil(readOverage / 1_000_000) * D1_READ_OVERAGE_PER_MILLION_USD
      + Math.ceil(writeOverage / 1_000_000) * D1_WRITE_OVERAGE_PER_MILLION_USD,
    )
  })

  it('disables public live D1 fallback before it can exceed projected quota', async () => {
    const env = envWithUsage({
      reads: monthProjectionInput(0.91, D1_INCLUDED_MONTHLY_READS),
      writes: monthProjectionInput(0.2, D1_INCLUDED_MONTHLY_WRITES),
      updated_at: '2026-04-24T00:00:00.000Z',
    })

    expect(await isPublicLiveD1FallbackDisabled(env)).toBe(true)
  })
})
