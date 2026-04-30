import { describe, expect, it } from 'vitest'
import { VALIDATE_COMMON } from '../src/ingest/validate-common'
import { buildCoverageGapRemediationRunId } from '../src/utils/idempotency'

describe('buildCoverageGapRemediationRunId', () => {
  it('stays within MAX_RUN_ID_LENGTH for normalized rate row validation', () => {
    const max = VALIDATE_COMMON.MAX_RUN_ID_LENGTH
    for (let i = 0; i < 20; i += 1) {
      const id = buildCoverageGapRemediationRunId('2026-04-19')
      expect(id.length).toBeLessThanOrEqual(max)
      expect(id).toMatch(/^daily:2026-04-19:cgr:[a-f0-9]+$/)
    }
  })
})
