import { describe, expect, it } from 'vitest'
import { buildReplayKey } from '../src/db/ingest-replay-queue'

describe('ingest replay queue keys', () => {
  it('encodes lender, dataset, product, and collection date for product detail jobs', () => {
    const key = buildReplayKey({
      kind: 'product_detail_fetch',
      runId: 'daily:2026-03-14:2026-03-14T00:00:00.000Z',
      runSource: 'scheduled',
      lenderCode: 'anz',
      dataset: 'home_loans',
      productId: 'HL-123',
      collectionDate: '2026-03-14',
      attempt: 0,
      idempotencyKey: 'product:daily-2026-03-14-anz-home-loans-hl-123',
    })

    expect(key).toContain('product-detail-fetch')
    expect(key).toContain('anz')
    expect(key).toContain('home-loans')
    expect(key).toContain('hl-123')
    expect(key).toContain('2026-03-14')
  })
})
