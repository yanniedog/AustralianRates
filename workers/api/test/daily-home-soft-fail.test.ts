import { describe, expect, it } from 'vitest'
import { shouldShortCircuitAfterHomeLoanIndexFetch, shouldSoftFailNoSignals } from '../src/queue/consumer/handlers/daily-home-loans'

describe('daily home-loan ubank soft-fail', () => {
  it('soft-fails ubank when upstream statuses are persistently non-2xx', () => {
    expect(
      shouldSoftFailNoSignals({
        lenderCode: 'ubank',
        successfulIndexFetch: false,
        observedUpstreamStatuses: [403, 403, 404],
      }),
    ).toBe(true)
  })

  it('does not soft-fail when a successful upstream status exists', () => {
    expect(
      shouldSoftFailNoSignals({
        lenderCode: 'ubank',
        successfulIndexFetch: false,
        observedUpstreamStatuses: [403, 200],
      }),
    ).toBe(false)
  })

  it('does not short-circuit to detail jobs when a successful index returns zero products', () => {
    expect(
      shouldShortCircuitAfterHomeLoanIndexFetch({
        successfulIndexFetch: true,
        discoveredProductCount: 0,
      }),
    ).toBe(false)
    expect(
      shouldShortCircuitAfterHomeLoanIndexFetch({
        successfulIndexFetch: true,
        discoveredProductCount: 3,
      }),
    ).toBe(true)
  })
})
