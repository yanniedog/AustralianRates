/**
 * Queue backfill day message handling. Requires real Queue and D1 (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real bindings.
 */
import { describe, it } from 'vitest'

describe('queue backfill day message (requires real Queue/D1)', () => {
  it.skip('acks non-retryable unknown lender error')
})
