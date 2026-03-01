/**
 * Query filter SQL generation. Requires real D1 (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real D1.
 */
import { describe, it } from 'vitest'

describe('query filter SQL generation (requires real D1)', () => {
  it.skip('applies multi-bank, numeric bounds, and default removed filtering for home-loan latest')
  it.skip('omits removed filtering when includeRemoved is true for home-loan latest')
  it.skip('supports multi-bank and min/max headline filtering for savings latest')
  it.skip('supports multi-bank and min/max headline filtering for term-deposit latest')
})
