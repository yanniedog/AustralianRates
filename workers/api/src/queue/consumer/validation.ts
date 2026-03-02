import { type NormalizedRateRow, validateNormalizedRow } from '../../ingest/normalize'
import { validateNormalizedSavingsRow, type NormalizedSavingsRow, validateNormalizedTdRow, type NormalizedTdRow } from '../../ingest/normalize-savings'

export type DroppedRow<T> = {
  reason: string
  productId: string
  row: T
}

export function splitValidatedRows(rows: NormalizedRateRow[]): {
  accepted: NormalizedRateRow[]
  dropped: Array<DroppedRow<NormalizedRateRow>>
} {
  const accepted: NormalizedRateRow[] = []
  const dropped: Array<DroppedRow<NormalizedRateRow>> = []
  for (const row of rows) {
    const verdict = validateNormalizedRow(row)
    if (verdict.ok) {
      accepted.push(row)
    } else {
      dropped.push({
        reason: verdict.reason,
        productId: row.productId,
        row,
      })
    }
  }
  return { accepted, dropped }
}

export function splitValidatedSavingsRows(rows: NormalizedSavingsRow[]) {
  const accepted: NormalizedSavingsRow[] = []
  const dropped: Array<DroppedRow<NormalizedSavingsRow>> = []
  for (const row of rows) {
    const verdict = validateNormalizedSavingsRow(row)
    if (verdict.ok) accepted.push(row)
    else dropped.push({ reason: verdict.reason, productId: row.productId, row })
  }
  return { accepted, dropped }
}

export function splitValidatedTdRows(rows: NormalizedTdRow[]) {
  const accepted: NormalizedTdRow[] = []
  const dropped: Array<DroppedRow<NormalizedTdRow>> = []
  for (const row of rows) {
    const verdict = validateNormalizedTdRow(row)
    if (verdict.ok) accepted.push(row)
    else dropped.push({ reason: verdict.reason, productId: row.productId, row })
  }
  return { accepted, dropped }
}
