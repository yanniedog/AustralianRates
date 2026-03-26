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

  it('keeps the same warning actionable for other lenders', () => {
    expect(
      shouldIgnoreStatusActionableLog(
        {
          lender_code: 'cba',
          source: 'consumer',
          message: 'daily_savings_lender_fetch empty_result',
        },
        'active',
      ),
    ).toBe(false)
  })
})
