import { describe, expect, it } from 'vitest'
import { shouldSoftFailNoSignals } from '../src/queue/consumer/handlers/daily-home-loans'

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
})
