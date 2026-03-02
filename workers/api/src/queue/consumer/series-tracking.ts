import { markRunSeenProduct, markRunSeenSeries } from '../../db/catalog'
import type { DatasetKind } from '../../../../../packages/shared/src'
import { homeLoanSeriesKey, savingsSeriesKey, tdSeriesKey } from '../../utils/series-identity'
import type { NormalizedRateRow } from '../../ingest/normalize'
import type { NormalizedSavingsRow, NormalizedTdRow } from '../../ingest/normalize-savings'

export function bankNameForLender(lender: { canonical_bank_name: string; name: string }): string {
  return lender.canonical_bank_name || lender.name
}

export async function markProductsSeenForRun(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    dataset: DatasetKind
    bankName: string
    collectionDate: string
    productIds: string[]
  },
): Promise<void> {
  for (const productId of Array.from(new Set(input.productIds)).filter(Boolean)) {
    await markRunSeenProduct(db, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: input.dataset,
      bankName: input.bankName,
      productId,
      productCode: productId,
      collectionDate: input.collectionDate,
    })
  }
}

export async function markHomeLoanSeriesSeenForRun(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    collectionDate: string
    rows: NormalizedRateRow[]
  },
): Promise<void> {
  for (const row of input.rows) {
    await markRunSeenSeries(db, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'home_loans',
      bankName: row.bankName,
      seriesKey: homeLoanSeriesKey(row),
      productId: row.productId,
      productCode: row.productId,
      collectionDate: input.collectionDate,
    })
  }
}

export async function markSavingsSeriesSeenForRun(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    collectionDate: string
    rows: NormalizedSavingsRow[]
  },
): Promise<void> {
  for (const row of input.rows) {
    await markRunSeenSeries(db, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'savings',
      bankName: row.bankName,
      seriesKey: savingsSeriesKey(row),
      productId: row.productId,
      productCode: row.productId,
      collectionDate: input.collectionDate,
    })
  }
}

export async function markTdSeriesSeenForRun(
  db: D1Database,
  input: {
    runId: string
    lenderCode: string
    collectionDate: string
    rows: NormalizedTdRow[]
  },
): Promise<void> {
  for (const row of input.rows) {
    await markRunSeenSeries(db, {
      runId: input.runId,
      lenderCode: input.lenderCode,
      dataset: 'term_deposits',
      bankName: row.bankName,
      seriesKey: tdSeriesKey(row),
      productId: row.productId,
      productCode: row.productId,
      collectionDate: input.collectionDate,
    })
  }
}
