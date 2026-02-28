export type DatasetKind = 'home_loans' | 'savings' | 'term_deposits'

export type ValidationStatus = 'accepted' | 'anomaly' | 'rejected'

export type AnomalyReason =
  | 'missing_dataset_identity'
  | 'missing_product_code'
  | 'invalid_collection_date'
  | 'invalid_source_payload'
  | 'unknown_enum'
  | 'unexpected_term_length'
  | 'rate_outlier'
  | 'product_name_heuristic_mismatch'
  | 'validation_rule_mismatch'

export type IngestTaskKind =
  | 'daily_lender_fetch'
  | 'daily_savings_lender_fetch'
  | 'product_detail_fetch'
  | 'backfill_snapshot_fetch'
  | 'backfill_day_fetch'
  | 'historical_task_execute'
  | 'lender_finalize'

export type SeriesKeyParts = {
  dataset: DatasetKind
  bankName: string
  productId: string
  securityPurpose?: string | null
  repaymentType?: string | null
  lvrTier?: string | null
  rateStructure?: string | null
  accountType?: string | null
  rateType?: string | null
  depositTier?: string | null
  termMonths?: number | string | null
  interestPayment?: string | null
}

export type FetchEvent = {
  runId?: string | null
  lenderCode?: string | null
  dataset?: DatasetKind | null
  jobKind?: IngestTaskKind | null
  sourceType: string
  sourceUrl: string
  collectionDate?: string | null
  fetchedAt: string
  httpStatus?: number | null
  contentHash: string
  bodyBytes: number
  responseHeadersJson?: string | null
  durationMs?: number | null
  productId?: string | null
  rawObjectCreated: boolean
  notes?: string | null
}
