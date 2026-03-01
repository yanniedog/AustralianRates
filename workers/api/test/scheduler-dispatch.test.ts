/**
 * Scheduler dispatch. Requires real env (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real bindings.
 */
import { describe, it } from 'vitest'

describe('scheduler dispatch (requires real bindings)', () => {
  it.skip('dispatches daily cron to daily handler')
  it.skip('skips unknown cron expressions')
  it.skip('skips former hourly wayback cron (0 * * * *) when only daily is configured')
})
