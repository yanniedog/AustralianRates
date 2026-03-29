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

describe('status-page-diagnostics provenance rollup', () => {
  it('treats warning-only CDR findings as yellow historical debt', () => {
    const bundle = {
      ...baseBundle(),
      cdr_audit: {
        report: {
          ok: false,
          totals: {
            failed: 1,
            errors: 0,
            warns: 1,
          },
          failures: [
            {
              id: 'stored_missing_fetch_event_links',
              severity: 'warn',
              summary: 'Historical stored rows older than the retained provenance window no longer have live fetch_event lineage.',
            },
          ],
        },
      },
      diagnostics_backlog: {
        ready_finalizations: { total: 0, cutoff_iso: '', idle_minutes: 5, rows: [] },
        stale_running_runs: { total: 0, cutoff_iso: '', stale_run_minutes: 120, rows: [] },
        missing_fetch_event_lineage: { total: 42, cutoff_date: '2026-03-28', lookback_days: 3650, rows: [] },
      },
    }

    const diagnostics = buildStatusPageDiagnosticsFromBundle(bundle) as {
      executive: { worst_severity: string; attention_items: string[] }
    }

    expect(diagnostics.executive.worst_severity).toBe('yellow')
    expect(diagnostics.executive.attention_items).toContain('CDR pipeline audit: 1 historical / warning check(s)')
    expect(diagnostics.executive.attention_items).toContain(
      'Historical provenance backlog: 42 row(s) with missing fetch_event lineage',
    )
  })

  it('prefers explicit provenance summary over raw backlog counts', () => {
    const bundle = {
      ...baseBundle(),
      historical_provenance: {
        available: true,
        legacy_unverifiable_rows: 42,
        quarantined_rows: 0,
        verified_reconstructed_rows: 9,
      },
      diagnostics_backlog: {
        ready_finalizations: { total: 0, cutoff_iso: '', idle_minutes: 5, rows: [] },
        stale_running_runs: { total: 0, cutoff_iso: '', stale_run_minutes: 120, rows: [] },
        missing_fetch_event_lineage: { total: 42, cutoff_date: '2026-03-28', lookback_days: 3650, rows: [] },
      },
    }

    const diagnostics = buildStatusPageDiagnosticsFromBundle(bundle) as {
      executive: { worst_severity: string; attention_items: string[] }
      historical_provenance: { legacy_unverifiable_rows: number } | null
    }

    expect(diagnostics.historical_provenance?.legacy_unverifiable_rows).toBe(42)
    expect(diagnostics.executive.worst_severity).toBe('yellow')
    expect(diagnostics.executive.attention_items).toContain('Historical provenance: 42 legacy unverifiable row(s) remain')
    expect(diagnostics.executive.attention_items).not.toContain(
      'Historical provenance backlog: 42 row(s) with missing fetch_event lineage',
    )
  })

  it('raises red attention when provenance rows are quarantined', () => {
    const diagnostics = buildStatusPageDiagnosticsFromBundle({
      ...baseBundle(),
      historical_provenance: {
        available: true,
        legacy_unverifiable_rows: 5,
        quarantined_rows: 3,
        verified_reconstructed_rows: 11,
      },
    }) as {
      executive: { worst_severity: string; attention_items: string[] }
    }

    expect(diagnostics.executive.worst_severity).toBe('red')
    expect(diagnostics.executive.attention_items).toContain(
      'Historical provenance: 3 quarantined row(s) need forensic review',
    )
  })

  it('uses diagnostics health snapshot when health section is omitted', () => {
    const diagnostics = buildStatusPageDiagnosticsFromBundle({
      meta: { sections: ['cdr'] },
      diagnostics: {
        health_run_id: 'health:manual:test',
        checked_at: '2026-03-28T20:22:20.823Z',
        overall_ok: true,
        failures: [],
        economic: { severity: 'green' },
        e2e: {
          aligned: true,
          reason_code: 'e2e_ok',
          target_collection_date: '2026-03-29',
        },
      },
      cdr_audit: {
        report: {
          ok: true,
          totals: { failed: 0, errors: 0, warns: 0 },
          failures: [],
        },
      },
    }) as {
      executive: { attention_items: string[] }
      health_run: { run_id: string } | null
    }

    expect(diagnostics.health_run?.run_id).toBe('health:manual:test')
    expect(diagnostics.executive.attention_items).not.toContain('No persisted health run in D1 (run a health check).')
  })

  it('surfaces active blocked writes and persisted anomaly findings from the integrity audit snapshot', () => {
    const diagnostics = buildStatusPageDiagnosticsFromBundle({
      ...baseBundle(),
      integrity_audit: {
        latest: {
          run_id: 'integrity:manual:test',
          checked_at: '2026-03-29T01:00:00.000Z',
          trigger_source: 'manual',
          status: 'red',
          overall_ok: false,
          duration_ms: 250,
          summary: { failed: 3 },
          findings: [
            { check: 'recent_blocked_write_contract_violations', passed: false, count: 2, category: 'erroneous' },
            { check: 'recent_same_day_series_conflicts', passed: false, count: 1, category: 'invalid' },
            { check: 'recent_abrupt_rate_movements', passed: false, count: 4, category: 'invalid' },
          ],
        },
        history: [],
      },
    }) as {
      executive: { worst_severity: string; attention_items: string[] }
    }

    expect(diagnostics.executive.worst_severity).toBe('red')
    expect(diagnostics.executive.attention_items).toContain('Active blocked write-contract violations: 2 recent row(s) quarantined')
    expect(diagnostics.executive.attention_items).toContain('Historical data conflicts: 1 same-day series conflict group(s)')
    expect(diagnostics.executive.attention_items).toContain('Historical data anomalies: 4 abrupt rate movement(s) need review')
  })

  it('surfaces current-day provenance and roster failures from the integrity audit snapshot', () => {
    const diagnostics = buildStatusPageDiagnosticsFromBundle({
      ...baseBundle(),
      integrity_audit: {
        latest: {
          run_id: 'integrity:manual:test',
          checked_at: '2026-03-30T01:00:00.000Z',
          trigger_source: 'manual',
          status: 'red',
          overall_ok: false,
          duration_ms: 250,
          summary: { failed: 2 },
          findings: [
            {
              check: 'current_collection_exact_provenance',
              passed: false,
              count: 3,
              category: 'dead',
              detail: { unverified_row_count: 3 },
            },
            {
              check: 'current_collection_expected_product_roster',
              passed: false,
              count: 2,
              category: 'erroneous',
              detail: { failing_scope_count: 2, missing_expected_product_count: 7 },
            },
          ],
        },
        history: [],
      },
    }) as {
      executive: { worst_severity: string; attention_items: string[] }
    }

    expect(diagnostics.executive.worst_severity).toBe('red')
    expect(diagnostics.executive.attention_items).toContain(
      'Current collection provenance: 3 row(s) are not verified_exact',
    )
    expect(diagnostics.executive.attention_items).toContain(
      'Current collection roster: 2 failing lender/dataset scope(s), 7 missing expected product(s)',
    )
  })
})
