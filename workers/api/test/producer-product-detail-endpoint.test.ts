import { describe, expect, it } from 'vitest'
import { enqueueDailySavingsLenderJobs, enqueueProductDetailJobs } from '../src/queue/producer'
import type { EnvBindings, IngestMessage } from '../src/types'

describe('product detail queue producer', () => {
  it('passes endpoint overrides through to queued detail jobs', async () => {
    const sentBodies: IngestMessage[] = []
    const env = {
      INGEST_QUEUE: {
        sendBatch: async (batch: Array<{ body: IngestMessage }>) => {
          for (const message of batch) sentBodies.push(message.body)
        },
      } as unknown as Queue<IngestMessage>,
    } as Pick<EnvBindings, 'INGEST_QUEUE'>

    const result = await enqueueProductDetailJobs(env, {
      runId: 'run-1',
      lenderCode: 'ing',
      dataset: 'home_loans',
      collectionDate: '2026-03-05',
      productIds: ['p-1', 'p-2', 'p-1'],
      endpointUrlByProductId: {
        'p-1': 'https://id.ob.ing.com.au/cds-au/v1/banking/products',
        'p-2': 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
      },
      fallbackFetchEventIdByProductId: {
        'p-1': 101,
        'p-2': 202,
      },
    })

    expect(result.enqueued).toBe(2)
    expect(sentBodies).toHaveLength(2)
    expect(sentBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'product_detail_fetch',
          productId: 'p-1',
          endpointUrl: 'https://id.ob.ing.com.au/cds-au/v1/banking/products',
          fallbackFetchEventId: 101,
        }),
        expect.objectContaining({
          kind: 'product_detail_fetch',
          productId: 'p-2',
          endpointUrl: 'https://api.commbank.com.au/public/cds-au/v1/banking/products',
          fallbackFetchEventId: 202,
        }),
      ]),
    )
  })

  it('passes dataset filters through to queued savings/td daily jobs', async () => {
    const sentBodies: IngestMessage[] = []
    const env = {
      INGEST_QUEUE: {
        sendBatch: async (batch: Array<{ body: IngestMessage }>) => {
          for (const message of batch) sentBodies.push(message.body)
        },
      } as unknown as Queue<IngestMessage>,
    } as Pick<EnvBindings, 'INGEST_QUEUE'>

    const result = await enqueueDailySavingsLenderJobs(env, {
      runId: 'run-2',
      collectionDate: '2026-03-05',
      lenders: [
        {
          code: 'ing',
          name: 'ING',
          canonical_bank_name: 'ING',
          register_brand_name: 'ING',
          seed_rate_urls: [],
        },
      ],
      datasets: ['savings'],
    })

    expect(result.enqueued).toBe(1)
    expect(sentBodies).toHaveLength(1)
    expect(sentBodies[0]).toEqual(
      expect.objectContaining({
        kind: 'daily_savings_lender_fetch',
        lenderCode: 'ing',
        datasets: ['savings'],
      }),
    )
  })
})
