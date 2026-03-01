/**
 * DB layer tests for historical rate upserts. Require real D1 (run with vitest-pool-workers or integration).
 * No mock or simulated data; these tests are skipped until run with real D1.
 */
import { describe, it } from 'vitest'

describe('upsertHistoricalRateRow (requires real D1)', () => {
  it.skip('throws with invalid_normalized_rate_row reason when interest_rate is structurally implausible')
  it.skip('throws when product_id is missing')
  it.skip('throws when source_url is invalid')
  it.skip('accepts optional product_url and published_at')
})
