import { describe, expect, it } from 'vitest'
import { markMissingProductsRemoved, markProductsSeen } from '../src/db/product-status'

type PresenceRow = {
  section: string
  bankName: string
  productId: string
  isRemoved: boolean
  removedAt: string | null
  lastSeenCollectionDate: string | null
  lastSeenRunId: string | null
}

function makePresenceDb() {
  const table = new Map<string, PresenceRow>()

  const keyOf = (section: string, bankName: string, productId: string) => `${section}|${bankName}|${productId}`

  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: Array<string | number | null>) => ({
        run: async () => {
          if (sql.includes('INSERT INTO product_presence_status')) {
            const section = String(binds[0] ?? '')
            const bankName = String(binds[1] ?? '')
            const productId = String(binds[2] ?? '')
            const collectionDate = binds[3] == null ? null : String(binds[3])
            const runId = binds[4] == null ? null : String(binds[4])
            const key = keyOf(section, bankName, productId)
            const prev = table.get(key)
            const changed =
              !prev ||
              prev.isRemoved ||
              prev.lastSeenCollectionDate !== collectionDate ||
              prev.lastSeenRunId !== runId

            table.set(key, {
              section,
              bankName,
              productId,
              isRemoved: false,
              removedAt: null,
              lastSeenCollectionDate: collectionDate,
              lastSeenRunId: runId,
            })

            return { meta: { changes: changed ? 1 : 0 } }
          }

          if (sql.includes('UPDATE product_presence_status')) {
            const section = String(binds[0] ?? '')
            const bankName = String(binds[1] ?? '')
            const activeIds = new Set(binds.slice(2).map((v) => String(v ?? '')))
            let changes = 0

            for (const row of table.values()) {
              if (row.section !== section) continue
              if (row.bankName !== bankName) continue
              if (row.isRemoved) continue
              if (activeIds.has(row.productId)) continue

              row.isRemoved = true
              if (!row.removedAt) row.removedAt = 'removed-at'
              changes += 1
            }

            return { meta: { changes } }
          }

          return { meta: { changes: 0 } }
        },
      }),
    }),
  } as unknown as D1Database

  return {
    db,
    snapshot: () => Array.from(table.values()),
  }
}

function findRow(rows: PresenceRow[], productId: string) {
  return rows.find((row) => row.productId === productId) || null
}

describe('product presence status', () => {
  it('supports seen -> removed -> reactivated transitions', async () => {
    const mock = makePresenceDb()

    const seenTouched = await markProductsSeen(mock.db, {
      section: 'home_loans',
      bankName: 'ANZ',
      productIds: ['p1', 'p2'],
      collectionDate: '2026-02-26',
      runId: 'run-1',
    })
    expect(seenTouched).toBe(2)

    const removedTouched = await markMissingProductsRemoved(mock.db, {
      section: 'home_loans',
      bankName: 'ANZ',
      activeProductIds: ['p1'],
    })
    expect(removedTouched).toBe(1)

    const afterRemoval = mock.snapshot()
    expect(findRow(afterRemoval, 'p1')?.isRemoved).toBe(false)
    expect(findRow(afterRemoval, 'p2')?.isRemoved).toBe(true)

    const reactivatedTouched = await markProductsSeen(mock.db, {
      section: 'home_loans',
      bankName: 'ANZ',
      productIds: ['p2'],
      collectionDate: '2026-02-27',
      runId: 'run-2',
    })
    expect(reactivatedTouched).toBe(1)

    const afterReactivate = mock.snapshot()
    expect(findRow(afterReactivate, 'p2')?.isRemoved).toBe(false)
    expect(findRow(afterReactivate, 'p2')?.removedAt).toBeNull()
    expect(findRow(afterReactivate, 'p2')?.lastSeenCollectionDate).toBe('2026-02-27')
  })

  it('de-duplicates seen product IDs before writes', async () => {
    const mock = makePresenceDb()
    const touched = await markProductsSeen(mock.db, {
      section: 'savings',
      bankName: 'CBA',
      productIds: ['p-1', 'p-1', '  p-1  ', ''],
      collectionDate: '2026-02-26',
      runId: 'run-1',
    })

    expect(touched).toBe(1)
    expect(mock.snapshot()).toHaveLength(1)
  })
})

