/**
 * Hourly wayback pipeline. Requires real D1, run lock, and pipeline (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real bindings.
 */
import { describe, it } from 'vitest'

describe('hourly wayback pipeline (requires real D1/bindings)', () => {
  it.skip('enqueues one date per dataset and decrements each cursor by one day')
  it.skip('skips when no datasets need backfill')
})
