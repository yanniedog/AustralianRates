import { describe, expect, it } from 'vitest'
import { shouldIgnoreStatusActionableLog } from '../src/utils/status-actionable-filter'

describe('shouldIgnoreStatusActionableLog', () => {
  it('ignores resolved ingest-paused warnings outside repair mode', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          code: 'ingest_paused',
          level: 'warn',
          source: 'scheduler',
          message: 'Scheduled daily ingest paused by app config',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores known ubank upstream-block noise in status summaries', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          lender_code: 'ubank',
          source: 'consumer',
          message: 'daily_savings_lender_fetch empty_result',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores cdr audit gaps in status summaries because the audit has its own panel', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'admin',
          message: 'cdr_audit_detected_gaps',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores admin cdr_audit_detected_gaps by code when message differs', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'admin',
          code: 'cdr_audit_detected_gaps',
          message: 'CDR audit detected pipeline gaps',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores no-signal historical task warnings in status summaries', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'consumer',
          message: 'historical_task_execute completed',
          context:
            '{"context":"task_id=5488 signals(wayback=0,final=0) completion=warn_no_writes","traceback":"Error"}',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores economic series parse failures when RBA upstream returned HTTP 403', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'economic',
          level: 'warn',
          message: 'Economic series parsing failed',
          code: 'economic_series_parse_failed',
          context: '{"series_id":"bank_bill_90d","message":"upstream_not_ok:403:https://www.rba.gov.au/x"}',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores economic series collection failed (markSeriesFailure) when RBA returned HTTP 403', () => {
    const inner = JSON.stringify({
      series_id: 'commodity_prices',
      source_url: 'https://www.rba.gov.au/statistics/tables/csv/i2-data.csv',
      message: 'upstream_not_ok:403:https://www.rba.gov.au/statistics/tables/csv/i2-data.csv',
    })
    const enriched = JSON.stringify({ context: inner, traceback: 'Error: stack' })
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'economic',
          level: 'warn',
          message: 'Economic series collection failed',
          code: 'economic_series_fetch_failed',
          context: enriched,
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores FRED upstream 520 for economic series warns (CDN edge)', () => {
    const inner = JSON.stringify({
      series_id: 'china_gdp_proxy',
      message: 'upstream_not_ok:520:https://fred.stlouisfed.org/graph/fredgraph.csv?id=CHNGDPNQD',
    })
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'economic',
          level: 'warn',
          message: 'Economic series collection failed',
          code: 'economic_series_fetch_failed',
          context: JSON.stringify({ context: inner, traceback: 'Error' }),
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores RBNZ OCR empty-parse drift while upstream fetch path succeeded', () => {
    const inner = JSON.stringify({
      series_id: 'rbnz_ocr',
      message: 'No parseable observations for rbnz_ocr',
    })
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'economic',
          level: 'warn',
          message: 'Economic series parsing failed',
          code: 'economic_series_parse_failed',
          context: JSON.stringify({ context: inner, traceback: 'Error' }),
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores economic RBA 403 when D1 returns context as parsed object', () => {
    const inner = JSON.stringify({
      series_id: 'bank_bill_90d',
      message: 'upstream_not_ok:403:https://www.rba.gov.au/x.csv',
    })
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'economic',
          level: 'warn',
          message: 'Economic series parsing failed',
          code: 'economic_series_parse_failed',
          context: { context: inner, traceback: 'Error: stack' },
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores legacy CPI collection warns when both RBA paths hit HTTP 403 (bot wall)', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'pipeline',
          level: 'warn',
          message: 'cpi_collection_unavailable',
          context: '{"context":"html status=403 reason=no_points_or_non_ok g1 status=403 reason=non_ok"}',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores transient RBA cash-rate upstream fetch timeouts in actionable status', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'pipeline',
          level: 'warn',
          message: 'upstream_fetch',
          context: 'source=rba_csv host=www.rba.gov.au elapsed_ms=45690 timed_out=1 timeout=1 status=0',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores RBA collection fallback to stored rate (operational, not a failure)', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'pipeline',
          level: 'warn',
          message: 'rba_collection_used_stored_rate',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores legacy reconciliation stall logs before ready_candidate_rows context was added', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'scheduler',
          level: 'error',
          message: 'Run lifecycle reconciliation stalled',
          context: '{"scanned_rows":3,"finalized_rows":0}',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('keeps reconciliation stall actionable when context includes ready_candidate_rows', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'scheduler',
          level: 'error',
          message: 'Run lifecycle reconciliation stalled',
          context: '{"ready_candidate_rows":2,"finalized_rows":0}',
        },
        'active',
      ),
    ).toBe(false)
  })

  it('ignores admin auth-check failures (expired sessions / unauthenticated probes)', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'admin',
          level: 'warn',
          message: 'auth_check_failed',
          code: 'admin_auth_check_failed',
        },
        'active',
      ),
    ).toBe(true)
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'admin',
          level: 'warn',
          message: 'auth_check_failed',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores chart_cache_refresh "Failed to refresh" messages in status summaries', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'chart_cache_refresh',
          message: 'Failed to refresh term_deposits change',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores client-side economic log-scale fallback warnings', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'client',
          level: 'warn',
          message: 'Economic chart: log y-axis disabled (non-positive index values); using linear',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores client extension crashes while keeping site-originated client errors actionable', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'client',
          level: 'error',
          code: 'client_error',
          message: 'Economic page unhandled error',
          context: {
            context: '{"filename":"chrome-extension://abcdef/evmAsk.js","message":"Uncaught TypeError"}',
          },
        },
        'active',
      ),
    ).toBe(true)
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'client',
          level: 'error',
          code: 'client_error',
          message: 'Economic page unhandled error',
          context: {
            context: '{"filename":"https://www.australianrates.com/economic-data.js","message":"Uncaught TypeError"}',
          },
        },
        'active',
      ),
    ).toBe(false)
  })

  it('ignores daily savings empty_result noise for non-UBank lenders too', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          lender_code: 'cba',
          source: 'consumer',
          message: 'daily_savings_lender_fetch empty_result',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores db upsert_failed when context is invalid_run_id from pre-validation runId (historical)', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'db',
          level: 'error',
          code: 'upsert_failed',
          message: 'upsert_failed product=x bank=ING date=2026-03-27',
          context: { context: 'invalid_normalized_rate_row:invalid_run_id' },
        },
        'active',
      ),
    ).toBe(true)
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'db',
          level: 'error',
          code: 'upsert_failed',
          message: 'upsert_failed product=x bank=ING date=2026-03-27',
          context: { context: 'D1_ERROR: constraint failed' },
        },
        'active',
      ),
    ).toBe(false)
  })

  it('ignores historical run lifecycle reconciliation failures caused by rowid on WITHOUT ROWID lender_dataset_runs', () => {
    const ctxFromProd = {
      context: 'D1_ERROR: no such column: rowid at offset 7: SQLITE_ERROR',
      error: { name: 'Error', message: 'D1_ERROR: no such column: rowid at offset 7: SQLITE_ERROR' },
      traceback:
        'Error: D1_ERROR: no such column: rowid at offset 7: SQLITE_ERROR\n    at async forceFinalizeAllUnfinalizedForRun (index.js:1:1)',
    }
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'scheduler',
          level: 'error',
          code: 'run_lifecycle_reconciliation_failed',
          message: 'Run lifecycle reconciliation failed',
          context: ctxFromProd,
        },
        'active',
      ),
    ).toBe(true)
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'scheduler',
          level: 'error',
          code: 'run_lifecycle_reconciliation_failed',
          message: 'Run lifecycle reconciliation failed',
          context: { context: 'D1_ERROR: some other schema error' },
        },
        'active',
      ),
    ).toBe(false)
  })

  it('ignores manual admin diagnostics and lineage-repair endpoint crashes', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'api',
          level: 'error',
          message: 'Unhandled internal error',
          context: '{"context":"{\\"method\\":\\"POST\\",\\"path\\":\\"/api/home-loan-rates/admin/runs/repair-lineage\\"}"}',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores exhausted retries from ad hoc admin historical tasks', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'consumer',
          level: 'error',
          code: 'queue_message_exhausted',
          message: 'queue_message_exhausted max_attempts=3',
          run_id: 'historical:admin:2020-02-26:2020-02-26:test-run',
          context: 'kind=historical_task_execute queue_attempt=4/3 error=D1_ERROR',
        },
        'active',
      ),
    ).toBe(true)
  })

  it('ignores replay scheduling noise from ad hoc admin historical tasks', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          source: 'consumer',
          level: 'error',
          message: 'replay_queue_scheduled',
          run_id: 'historical:admin:2020-02-26:2020-02-26:test-run',
          context: 'kind=historical_task_execute replay_status=queued error=D1_ERROR',
        },
        'active',
      ),
    ).toBe(true)
  })
})
