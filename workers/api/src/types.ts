import type { JWTPayload } from 'jose'
import type { DatasetKind, IngestTaskKind } from '../../../packages/shared/src/index.js'

export type RunType = 'daily' | 'backfill'
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed'
export type IngestPauseMode = 'active' | 'repair_pause'

export type SourceType = 'cdr_register' | 'cdr_products' | 'cdr_product_detail' | 'wayback_html'

export type SecurityPurpose = 'owner_occupied' | 'investment'
export type RepaymentType = 'principal_and_interest' | 'interest_only'
export type RateStructure = 'variable' | 'fixed_1yr' | 'fixed_2yr' | 'fixed_3yr' | 'fixed_4yr' | 'fixed_5yr'
export type LvrTier =
  | 'lvr_=60%'
  | 'lvr_60-70%'
  | 'lvr_70-80%'
  | 'lvr_80-85%'
  | 'lvr_85-90%'
  | 'lvr_90-95%'
  | 'lvr_unspecified'
export type FeatureSet = 'basic' | 'premium'

export type SavingsAccountType = 'savings' | 'transaction' | 'at_call'
export type SavingsRateType = 'base' | 'bonus' | 'introductory' | 'bundle' | 'total'
export type InterestPayment = 'at_maturity' | 'monthly' | 'quarterly' | 'annually'

export type AdminAuthMode = 'bearer' | 'access'

export type AdminAuthState = {
  ok: boolean
  mode: AdminAuthMode | null
  reason?: string
  subject?: string
  jwtPayload?: JWTPayload
}

export type RunSource = 'scheduled' | 'manual'
export type RetrievalType = 'historical_scrape' | 'present_scrape_same_date'
export type HistoricalProductScope = 'all' | 'mortgage' | 'savings' | 'term_deposits'

export type AuditStage = 'retrieved' | 'processed' | 'stored' | 'archived' | 'tracked'

export type AuditCheckResult = {
  id: string
  stage: AuditStage
  title: string
  passed: boolean
  severity: 'info' | 'warn' | 'error'
  summary: string
  metrics: Record<string, number | string | boolean | null>
  sample_rows: Array<Record<string, unknown>>
  debug: Record<string, unknown>
  traceback: string | null
}

export type CdrAuditReport = {
  run_id: string
  generated_at: string
  ok: boolean
  totals: {
    checks: number
    failed: number
    errors: number
    warns: number
  }
  stages: Record<AuditStage, AuditCheckResult[]>
  failures: Array<{
    id: string
    stage: AuditStage
    severity: 'info' | 'warn' | 'error'
    summary: string
  }>
}

export type ExecutiveSummarySection = {
  dataset: 'home_loans' | 'savings' | 'term_deposits'
  title: 'Home Loans' | 'Savings' | 'Term Deposits'
  window_days: number
  window_start: string
  window_end: string
  partial: boolean
  metrics: {
    total_changes: number
    lender_coverage: number
    up_count: number
    down_count: number
    unchanged_count: number
    mean_move_bps: number | null
    median_move_bps: number | null
  }
  concentration: {
    top_lender: { bank_name: string; change_count: number; share_pct: number } | null
    top_lenders: Array<{ bank_name: string; change_count: number; share_pct: number }>
    top3_share_pct: number
  }
  standouts: {
    largest_increase: Record<string, unknown> | null
    largest_decrease: Record<string, unknown> | null
  }
  narrative: string
}

export type ExecutiveSummaryReport = {
  generated_at: string
  window_days: number
  sections: [ExecutiveSummarySection, ExecutiveSummarySection, ExecutiveSummarySection]
}

type ReplayMetadata = {
  replayTicketId?: string
  replayAttempt?: number
}

export type DailyLenderJob = ReplayMetadata & {
  kind: 'daily_lender_fetch'
  runId: string
  runSource: RunSource
  lenderCode: string
  collectionDate: string
  attempt: number
  idempotencyKey: string
}

export type ProductDetailJob = ReplayMetadata & {
  kind: 'product_detail_fetch'
  runId: string
  runSource: RunSource
  lenderCode: string
  dataset: DatasetKind
  productId: string
  endpointUrl?: string
  fallbackFetchEventId?: number | null
  collectionDate: string
  attempt: number
  idempotencyKey: string
}

export type LenderFinalizeJob = ReplayMetadata & {
  kind: 'lender_finalize'
  runId: string
  runSource: RunSource
  lenderCode: string
  dataset: DatasetKind
  collectionDate: string
  attempt: number
  idempotencyKey: string
}

export type BackfillSnapshotJob = ReplayMetadata & {
  kind: 'backfill_snapshot_fetch'
  runId: string
  runSource: RunSource
  lenderCode: string
  seedUrl: string
  monthCursor: string
  attempt: number
  idempotencyKey: string
}

export type BackfillDayJob = ReplayMetadata & {
  kind: 'backfill_day_fetch'
  runId: string
  runSource: RunSource
  lenderCode: string
  collectionDate: string
  attempt: number
  idempotencyKey: string
}

export type DailySavingsLenderJob = ReplayMetadata & {
  kind: 'daily_savings_lender_fetch'
  runId: string
  runSource: RunSource
  lenderCode: string
  collectionDate: string
  datasets?: Array<'savings' | 'term_deposits'>
  attempt: number
  idempotencyKey: string
}

export type HistoricalTaskExecuteJob = ReplayMetadata & {
  kind: 'historical_task_execute'
  runId: string
  runSource: RunSource
  taskId: number
  attempt: number
  idempotencyKey: string
}

export type IngestMessage =
  | DailyLenderJob
  | ProductDetailJob
  | LenderFinalizeJob
  | BackfillSnapshotJob
  | BackfillDayJob
  | DailySavingsLenderJob
  | HistoricalTaskExecuteJob

export type LenderConfig = {
  code: string
  name: string
  canonical_bank_name: string
  register_brand_name: string
  seed_rate_urls: string[]
  products_endpoint?: string
  additional_products_endpoints?: string[]
}

export type LenderConfigFile = {
  version: number
  generated_at: string
  lenders: LenderConfig[]
}

export type RunReportRow = {
  run_id: string
  run_type: RunType
  run_source: RunSource
  started_at: string
  finished_at: string | null
  status: RunStatus
  per_lender_json: string
  errors_json: string
}

export type EnvBindings = {
  DB: D1Database
  READ_DB?: D1Database
  RAW_BUCKET: R2Bucket
  INGEST_QUEUE: Queue<IngestMessage>
  IDEMPOTENCY_KV?: KVNamespace
  /** Optional: caches chart/pivot API responses for fast loads. Create via wrangler kv:namespace create "CHART_CACHE". */
  CHART_CACHE_KV?: KVNamespace
  RUN_LOCK_DO: DurableObjectNamespace
  HISTORICAL_QUALITY_AUDIT_DO?: DurableObjectNamespace
  ADMIN_API_TOKEN?: string
  ADMIN_API_TOKENS?: string
  /** Optional ABS Indicator API key for headline CPI/labour/demand/housing indicator feeds. */
  ABS_INDICATOR_API_KEY?: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  PUBLIC_ALLOWED_ORIGINS?: string
  WORKER_VERSION?: string
  PUBLIC_API_BASE_PATH?: string
  MELBOURNE_TIMEZONE?: string
  MELBOURNE_TARGET_HOUR?: string
  /** Default 18; paired with MELBOURNE_TARGET_HOUR when MELBOURNE_DAILY_INGEST_HOURS unset. */
  MELBOURNE_SECOND_INGEST_HOUR?: string
  /** Comma-separated Melbourne wall-clock hours (0–23) for scheduled ingest; overrides the two defaults when set. */
  MELBOURNE_DAILY_INGEST_HOURS?: string
  LOCK_TTL_SECONDS?: string
  MAX_QUEUE_ATTEMPTS?: string
  MAX_PRODUCTS_PER_LENDER?: string
  FEATURE_SCHEDULED_INGEST_AUDITS_ENABLED?: string
  FEATURE_SCHEDULED_PRODUCT_CLASSIFICATION_AUDIT_ENABLED?: string
  D1_DAILY_READ_LIMIT?: string
  D1_DAILY_WRITE_LIMIT?: string
  D1_NONESSENTIAL_DISABLE_FRACTION?: string
  FEATURE_PROSPECTIVE_ENABLED?: string
  FEATURE_BACKFILL_ENABLED?: string
  MANUAL_RUN_COOLDOWN_SECONDS?: string
  AUTO_BACKFILL_DAILY_QUEUE_CAP?: string
  PUBLIC_HISTORICAL_MAX_RANGE_DAYS?: string
  ADMIN_HISTORICAL_MAX_RANGE_DAYS?: string
  HISTORICAL_TASK_CLAIM_TTL_SECONDS?: string
  HISTORICAL_MAX_BATCH_ROWS?: string
  PUBLIC_HISTORICAL_COOLDOWN_SECONDS?: string
  FEATURE_PUBLIC_TRIGGER_RUN_ENABLED?: string
  FEATURE_PUBLIC_HISTORICAL_PULL_ENABLED?: string
  FEATURE_PUBLIC_EXPORT_JOB_ENABLED?: string
  FEATURE_INTEGRITY_PROBES_ENABLED?: string
  FEATURE_QUEUE_IDEMPOTENCY_ENABLED?: string
  IDEMPOTENCY_TTL_SECONDS?: string
  IDEMPOTENCY_LEASE_SECONDS?: string
  MAX_REPLAY_ATTEMPTS?: string
  REPLAY_BASE_DELAY_SECONDS?: string
  FETCH_TIMEOUT_MS?: string
  FETCH_MAX_RETRIES?: string
  FETCH_RETRY_BASE_MS?: string
  FETCH_RETRY_CAP_MS?: string
  /** Cloudflare account id for GraphQL Analytics API usage dashboards. */
  CLOUDFLARE_ACCOUNT_ID?: string
  /** Cloudflare API token with analytics read access. */
  CLOUDFLARE_API_TOKEN?: string
  /** Optional override for the production D1 database id used by usage dashboards. */
  CLOUDFLARE_D1_DATABASE_ID?: string
}

export type SharedIngestTaskKind = IngestTaskKind

export type AppContext = {
  Bindings: EnvBindings
  Variables: {
    adminAuthState?: AdminAuthState
    /** Lazy D1 read session (replica-capable); see `getReadDb`. */
    readD1?: D1Database
  }
}

export type MelbourneParts = {
  date: string
  hour: number
  minute: number
  second: number
  timeZone: string
  iso: string
}
