import { describe, expect, it } from 'vitest'
import { insertHealthCheckRun } from '../src/db/health-check-runs'

describe('health check run persistence', () => {
  it('persists full e2e_json when the column is available', async () => {
    var calls: Array<{ sql: string; args: unknown[] }> = []
    var db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql: sql, args: args })
            return this
          },
          async run() {
            return { meta: { changes: 1 } }
          },
        }
      },
    } as unknown as D1Database

    await insertHealthCheckRun(db, {
      runId: 'health:1',
      checkedAt: '2026-03-07T00:00:00.000Z',
      triggerSource: 'manual',
      overallOk: true,
      durationMs: 123,
      componentsJson: '[]',
      integrityJson: '{}',
      e2eJson: '{"aligned":true,"sourceMode":"all","datasets":[],"criteria":{"scheduler":true,"runsProgress":true,"apiServesLatest":true}}',
      e2eAligned: true,
      e2eReasonCode: 'e2e_ok',
      e2eReasonDetail: null,
      actionableJson: '[]',
      failuresJson: '[]',
    })

    expect(calls[0].sql).toContain('e2e_json')
    expect(calls[0].args).toContain('{"aligned":true,"sourceMode":"all","datasets":[],"criteria":{"scheduler":true,"runsProgress":true,"apiServesLatest":true}}')
  })
})
