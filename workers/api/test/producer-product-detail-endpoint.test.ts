import { describe, expect, it } from 'vitest'
import { enqueueProductDetailJobs } from '../src/queue/producer'
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
})
