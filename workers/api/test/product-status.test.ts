/**
 * Product presence status DB layer. Requires real D1 (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real D1.
 */
import { describe, it } from 'vitest'

describe('product presence status (requires real D1)', () => {
  it.skip('supports seen -> removed -> reactivated transitions')
  it.skip('de-duplicates seen product IDs before writes')
})
