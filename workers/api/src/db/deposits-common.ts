export const MIN_PUBLIC_RATE = 0
export const MAX_PUBLIC_RATE = 15
export const MIN_CONFIDENCE = 0.85
export const MIN_CONFIDENCE_HISTORICAL = 0.65

export const DEPOSIT_LATEST_ORDER_BY = {
  default: 'l.collection_date DESC, l.bank_name ASC, l.product_name ASC',
  rate_asc: 'l.interest_rate ASC, l.bank_name ASC',
  rate_desc: 'l.interest_rate DESC, l.bank_name ASC',
} as const
