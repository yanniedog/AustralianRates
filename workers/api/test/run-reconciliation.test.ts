import { describe, expect, it } from 'vitest'
import { deriveTerminalRunStatus, runLifecycleReconciliation } from '../src/pipeline/run-reconciliation'

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

  it('reconciles ready finalizations across multiple passes until exhausted', async () => {
    const readyPasses = [
      [
        {
          run_id: 'run:1',
          lender_code: 'anz',
          dataset_kind: 'home_loans',
          bank_name: 'ANZ',
          collection_date: '2026-03-07',
          expected_detail_count: 0,
          completed_detail_count: 0,
          failed_detail_count: 0,
          updated_at: '2026-03-07T00:00:00.000Z',
        },
        {
          run_id: 'run:2',
          lender_code: 'ubank',
          dataset_kind: 'savings',
          bank_name: 'ubank',
          collection_date: '2026-03-07',
          expected_detail_count: 0,
          completed_detail_count: 0,
          failed_detail_count: 0,
          updated_at: '2026-03-07T00:01:00.000Z',
        },
      ],
      [
        {
          run_id: 'run:3',
          lender_code: 'ing',
          dataset_kind: 'term_deposits',
          bank_name: 'ING',
          collection_date: '2026-03-07',
          expected_detail_count: 0,
          completed_detail_count: 0,
          failed_detail_count: 0,
          updated_at: '2026-03-07T00:02:00.000Z',
        },
      ],
      [],
    ]
    let passIndex = 0
    const db = {
      prepare(sql: string) {
        return {
          bind(..._args: unknown[]) {
            return this
          },
          async all() {
            if (sql.includes('FROM lender_dataset_runs') && sql.includes('ORDER BY updated_at ASC')) {
              const results = readyPasses[Math.min(passIndex, readyPasses.length - 1)]
              passIndex += 1
              return { results }
            }
            if (sql.includes("FROM run_reports") && sql.includes("status = 'running'")) {
              return { results: [] }
            }
            return { results: [] }
          },
          async run() {
            if (sql.includes('UPDATE lender_dataset_runs')) {
              return { meta: { changes: 1 } }
            }
            if (sql.includes('UPDATE run_reports')) {
              return { meta: { changes: 0 } }
            }
            return { meta: { changes: 0 } }
          },
          async first() {
            return null
          },
        }
      },
    } as unknown as D1Database

    const result = await runLifecycleReconciliation(db, {
      dryRun: false,
      idleMinutes: 5,
      staleRunMinutes: 120,
    })

    expect(result.ready_finalizations.pass_count).toBe(3)
    expect(result.ready_finalizations.scanned_rows).toBe(3)
    expect(result.ready_finalizations.finalized_rows).toBe(3)
    expect(result.ready_finalizations.stopped_reason).toBe('exhausted')
    expect(result.ready_finalizations.passes && result.ready_finalizations.passes[0].scanned_rows).toBe(2)
    expect(result.ready_finalizations.passes && result.ready_finalizations.passes[1].scanned_rows).toBe(1)
    expect(result.ready_finalizations.passes && result.ready_finalizations.passes[2].scanned_rows).toBe(0)
  })
})
