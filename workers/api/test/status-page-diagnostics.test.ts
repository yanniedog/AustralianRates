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

describe('status-page-diagnostics problem log rollup', () => {
  it('does not treat raw log volume as executive attention when actionable count is zero', () => {
    const bundle = {
      ...baseBundle(),
      logs: {
        total: 209,
        since_ts: '2026-03-28T00:00:00.000Z',
        entries: Array.from({ length: 3 }, (_, index) => ({
          code: `historical_noise_${index}`,
        })),
        actionable: {
          count: 0,
          scanned: 0,
          issues: [],
        },
      },
    }

    const diagnostics = buildStatusPageDiagnosticsFromBundle(bundle) as {
      executive: { attention_items: string[] }
      problem_logs_window: { total: number; actionable_count: number }
    }

    expect(diagnostics.problem_logs_window.total).toBe(209)
    expect(diagnostics.problem_logs_window.actionable_count).toBe(0)
    expect(diagnostics.executive.attention_items).not.toContain('Problem logs (window): 209 entries')
    expect(diagnostics.executive.attention_items).not.toContain('Actionable log issues: 0 group(s)')
  })

  it('surfaces filtered actionable log groups from the log window', () => {
    const bundle = {
      ...baseBundle(),
      logs: {
        total: 12,
        since_ts: '2026-03-28T00:00:00.000Z',
        entries: [{ code: 'site_health_diag_stale' }],
        actionable: {
          count: 2,
          scanned: 4,
          issues: [
            { code: 'site_health_diag_stale', count: 3 },
            { code: 'coverage_gap_open', count: 1 },
          ],
        },
      },
    }

    const diagnostics = buildStatusPageDiagnosticsFromBundle(bundle) as {
      executive: { attention_items: string[] }
      problem_logs_window: { actionable_count: number; actionable_top_codes: Array<{ code: string; count: number }> }
    }

    expect(diagnostics.problem_logs_window.actionable_count).toBe(2)
    expect(diagnostics.problem_logs_window.actionable_top_codes).toEqual([
      { code: 'site_health_diag_stale', count: 3 },
      { code: 'coverage_gap_open', count: 1 },
    ])
    expect(diagnostics.executive.attention_items).toContain('Actionable log issues: 2 group(s)')
  })
})
