import { describe, expect, it } from 'vitest'
import { deriveTerminalRunStatus } from '../src/pipeline/run-reconciliation'

describe('run lifecycle reconciliation status derivation', () => {
  it('returns ok when all enqueued work completed without failures', () => {
    expect(
      deriveTerminalRunStatus({
        enqueuedTotal: 12,
        processedTotal: 12,
        failedTotal: 0,
      }),
    ).toBe('ok')
  })

  it('returns partial when all enqueued work completed with failures', () => {
    expect(
      deriveTerminalRunStatus({
        enqueuedTotal: 12,
        processedTotal: 10,
        failedTotal: 2,
      }),
    ).toBe('partial')
  })

  it('returns partial when stale run is still short of enqueued totals', () => {
    expect(
      deriveTerminalRunStatus({
        enqueuedTotal: 20,
        processedTotal: 15,
        failedTotal: 1,
      }),
    ).toBe('partial')
  })

  it('returns partial when no enqueued totals are available', () => {
    expect(
      deriveTerminalRunStatus({
        enqueuedTotal: 0,
        processedTotal: 0,
        failedTotal: 0,
      }),
    ).toBe('partial')
  })

  it('returns partial when invariant violations remain after queue completion', () => {
    expect(
      deriveTerminalRunStatus(
        {
          enqueuedTotal: 12,
          processedTotal: 12,
          failedTotal: 0,
        },
        {
          problematic_rows: 2,
        },
      ),
    ).toBe('partial')
  })

  it.todo(
    'reconcile ready finalizations against a real lender_dataset_runs fixture or integration database; the fabricated D1 result-set test was removed under the real-data-only policy',
  )
})
