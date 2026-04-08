import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  claimHistoricalTaskById,
  createHistoricalRunWithTasks,
  finalizeHistoricalTask,
  getHistoricalRunById,
  listHistoricalTaskIds,
} from '../../src/db/client-historical-runs'

async function resetHistoricalTables(): Promise<void> {
  await env.DB.exec('DELETE FROM client_historical_batches;')
  await env.DB.exec('DELETE FROM client_historical_tasks;')
  await env.DB.exec('DELETE FROM client_historical_runs;')
}

describe('historical task claim/finalize flow', () => {
  it('marks the run running on claim without triggering a full stats recount, then refreshes on finalize', async () => {
    await resetHistoricalTables()

    const runId = `historical:test:${crypto.randomUUID()}`
    await createHistoricalRunWithTasks(env.DB, {
      runId,
      triggerSource: 'admin',
      requestedBy: 'integration-test',
      startDate: '2024-01-01',
      endDate: '2024-01-01',
      lenderCodes: ['anz'],
      productScope: 'all',
      runSource: 'manual',
    })

    const [taskId] = await listHistoricalTaskIds(env.DB, runId)
    expect(taskId).toBeTypeOf('number')

    const claimed = await claimHistoricalTaskById(env.DB, {
      runId,
      taskId,
      workerId: 'worker:test',
      claimTtlSeconds: 120,
    })

    expect(claimed?.status).toBe('claimed')

    const afterClaim = await getHistoricalRunById(env.DB, runId)
    expect(afterClaim?.status).toBe('running')
    expect(afterClaim?.started_at).toBeTruthy()
    expect(afterClaim?.pending_tasks).toBe(1)
    expect(afterClaim?.claimed_tasks).toBe(0)
    expect(afterClaim?.completed_tasks).toBe(0)

    const completed = await finalizeHistoricalTask(env.DB, {
      taskId,
      runId,
      workerId: 'worker:test',
      status: 'completed',
      hadSignals: true,
      lastError: null,
    })

    expect(completed?.status).toBe('completed')

    const afterFinalize = await getHistoricalRunById(env.DB, runId)
    expect(afterFinalize?.status).toBe('completed')
    expect(afterFinalize?.pending_tasks).toBe(0)
    expect(afterFinalize?.claimed_tasks).toBe(0)
    expect(afterFinalize?.completed_tasks).toBe(1)
    expect(afterFinalize?.failed_tasks).toBe(0)
  })
})
