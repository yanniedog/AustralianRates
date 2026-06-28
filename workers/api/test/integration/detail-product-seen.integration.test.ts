import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { finalizePresenceForRun } from '../../src/db/presence-finalize'
import {
  markProductsSeenForRun,
  productIdsSeenFromDetailFetch,
} from '../../src/queue/consumer/series-tracking'

async function resetPresenceTables(): Promise<void> {
  const tables = ['run_seen_products', 'run_seen_series', 'product_presence_status', 'product_catalog']
  for (const table of tables) {
    await env.DB.exec(`DELETE FROM ${table};`)
  }
}

async function seedActiveCatalogProduct(input: {
  productId: string
  bankName: string
  collectionDate: string
}): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO product_catalog (
         dataset_kind, bank_name, product_id, product_code,
         first_seen_collection_date, last_seen_collection_date
       ) VALUES ('home_loans', ?1, ?2, ?2, ?3, ?3)`,
    )
    .bind(input.bankName, input.productId, input.collectionDate)
    .run()
  await env.DB
    .prepare(
      `INSERT INTO product_presence_status (
         section, bank_name, product_id, is_removed, last_seen_collection_date
       ) VALUES ('home_loans', ?1, ?2, 0, ?3)`,
    )
    .bind(input.bankName, input.productId, input.collectionDate)
    .run()
}

describe('detail product seen tracking', () => {
  it('productIdsSeenFromDetailFetch always includes the detail job product id', () => {
    expect(productIdsSeenFromDetailFetch('P123', [])).toEqual(['P123'])
    expect(productIdsSeenFromDetailFetch('P123', ['P123', 'P456'])).toEqual(['P123', 'P456'])
  })

  it('keeps shell catalog products active when detail fetch returns zero ingestible rows', async () => {
    await resetPresenceTables()

    const productId = `shell-${crypto.randomUUID()}`
    const runId = `daily:test:${crypto.randomUUID()}`
    const bankName = 'ANZ'
    const collectionDate = '2026-06-28'

    await seedActiveCatalogProduct({ productId, bankName, collectionDate })

    await markProductsSeenForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
      productIds: productIdsSeenFromDetailFetch(productId, []),
    })

    const result = await finalizePresenceForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    expect(result.removedProducts).toBe(0)
    const presence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM product_presence_status
         WHERE section = 'home_loans' AND bank_name = ?1 AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()
    expect(Number(presence?.is_removed ?? 1)).toBe(0)
  })

  it('removes active catalog products that never reached run_seen_products', async () => {
    await resetPresenceTables()

    const productId = `missing-${crypto.randomUUID()}`
    const runId = `daily:test:${crypto.randomUUID()}`
    const bankName = 'ANZ'
    const collectionDate = '2026-06-28'

    await seedActiveCatalogProduct({ productId, bankName, collectionDate })

    const result = await finalizePresenceForRun(env.DB, {
      runId,
      lenderCode: 'anz',
      dataset: 'home_loans',
      bankName,
      collectionDate,
    })

    expect(result.removedProducts).toBe(1)
    const presence = await env.DB
      .prepare(
        `SELECT is_removed
         FROM product_presence_status
         WHERE section = 'home_loans' AND bank_name = ?1 AND product_id = ?2`,
      )
      .bind(bankName, productId)
      .first<{ is_removed: number }>()
    expect(Number(presence?.is_removed ?? 0)).toBe(1)
  })
})
