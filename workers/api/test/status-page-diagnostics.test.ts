import { describe, expect, it } from 'vitest'
import { buildStatusPageDiagnosticsFromBundle } from '../src/pipeline/status-page-diagnostics'

function baseBundle() {
  return {
    meta: { sections: ['health', 'coverage', 'replay'] },
    health: {
      latest: {
        run_id: 'health:manual:test',
        checked_at: '2026-03-28T20:22:20.823Z',
        trigger_source: 'manual',
        overall_ok: true,
        duration_ms: 100,
        components: [],
        integrity: { ok: true, checks: [] },
        economic: { summary: { severity: 'green' } },
        e2e: {
          aligned: true,
          reasonCode: 'e2e_ok',
          reasonDetail: '',
          checkedAt: '2026-03-28T20:22:20.823Z',
          targetCollectionDate: '2026-03-29',
          sourceMode: 'all',
          datasets: [],
          criteria: {
            scheduler: true,
            runsProgress: true,
            apiServesLatest: true,
          },
        },
        actionable: [],
        failures: [],
      },
    },
    coverage_gaps: {
      report: {
        collection_date: '2026-03-29',
        totals: {
          gaps: 0,
          errors: 0,
          warns: 0,
        },
        rows: [],
      },
    },
  }
}

describe('status-page-diagnostics replay queue rollup', () => {
  it('ignores historical failed replay rows when current health is green', () => {
    const bundle = {
      ...baseBundle(),
      replay_queue: {
        count: 1,
        rows: [
          {
            status: 'failed',
            lender_code: 'macquarie',
            dataset_kind: 'term_deposits',
            collection_date: '2026-03-25',
            updated_at: '2026-03-26T10:00:00.000Z',
            last_error: 'lender_finalize_not_ready:macquarie:term_deposits:zero_accepted_rows_for_nonzero_expected_details',
          },
        ],
      },
    }

    const diagnostics = buildStatusPageDiagnosticsFromBundle(bundle) as {
      executive: { attention_items: string[] }
      replay_queue: { failed: number; historical_failed_ignored: number }
    }

    expect(diagnostics.replay_queue.failed).toBe(0)
    expect(diagnostics.replay_queue.historical_failed_ignored).toBe(1)
    expect(diagnostics.executive.attention_items).not.toContain('Replay queue: 1 failed row(s)')
  })

  it('keeps current-date replay failures visible', () => {
    const bundle = {
      ...baseBundle(),
      replay_queue: {
        count: 1,
        rows: [
          {
            status: 'failed',
            lender_code: 'macquarie',
            dataset_kind: 'term_deposits',
            collection_date: '2026-03-29',
            updated_at: '2026-03-29T00:10:00.000Z',
            last_error: 'lender_finalize_not_ready:macquarie:term_deposits:zero_accepted_rows_for_nonzero_expected_details',
          },
        ],
      },
    }

    const diagnostics = buildStatusPageDiagnosticsFromBundle(bundle) as {
      executive: { attention_items: string[] }
      replay_queue: { failed: number; historical_failed_ignored: number }
    }

    expect(diagnostics.replay_queue.failed).toBe(1)
    expect(diagnostics.replay_queue.historical_failed_ignored).toBe(0)
    expect(diagnostics.executive.attention_items).toContain('Replay queue: 1 failed row(s)')
  })
})
