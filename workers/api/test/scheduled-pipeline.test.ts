/**
 * Scheduled daily pipeline. Requires real D1 and pipeline (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real bindings.
 */
import { describe, it } from 'vitest'

describe('scheduled pipeline (requires real D1/bindings)', () => {
  it.skip('uses a per-cron run id so each hourly tick can enqueue work')
  it.skip('does NOT update rate_check_last_run_iso when run is skipped')
  it.skip('updates rate_check_last_run_iso when run is skipped due to cooldown')
})
