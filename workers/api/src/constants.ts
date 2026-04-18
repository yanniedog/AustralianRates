import lendersConfigRaw from '../config/lenders.json' with { type: 'json' }
import type {
  FeatureSet,
  InterestPayment,
  LenderConfigFile,
  LvrTier,
  RateStructure,
  RepaymentType,
  SavingsAccountType,
  SavingsRateType,
  SecurityPurpose,
} from './types.js'

export const API_BASE_PATH = '/api/home-loan-rates'
export const SAVINGS_API_BASE_PATH = '/api/savings-rates'
export const TD_API_BASE_PATH = '/api/term-deposit-rates'
export const ECONOMIC_API_BASE_PATH = '/api/economic-data'
export const MELBOURNE_TIMEZONE = 'Australia/Melbourne'
export const MELBOURNE_TARGET_HOUR = 6
/** Second default wall-clock hour (Melbourne) for scheduled daily ingest when `MELBOURNE_DAILY_INGEST_HOURS` is unset. */
export const MELBOURNE_SECOND_INGEST_HOUR = 18
/**
 * Four UTC hours: pairs bracket Melbourne 06:00 (19,20) and 18:00 (07,08) across AEDT/AEST.
 * `handleScheduledDaily` gates on local hours from `MELBOURNE_DAILY_INGEST_HOURS` or 6+18.
 */
export const DAILY_SCHEDULE_CRON_EXPRESSION = '0 7,8,19,20 * * *'
export const SITE_HEALTH_CRON_EXPRESSION = '*/15 * * * *'
/** Top-of-hour UTC: Wayback backfill, chart pivot cache refresh, same-day RBA cash tick (not full daily ingest). */
export const HOURLY_MAINTENANCE_CRON_EXPRESSION = '0 * * * *'
/** 23:59 daily; handler runs monthly export only on the last day of each month. */
export const MONTHLY_EXPORT_CRON_EXPRESSION = '59 23 * * *'
/** 04:00 UTC daily; data integrity audit for admin UI. */
export const INTEGRITY_AUDIT_CRON_EXPRESSION = '0 4 * * *'
/** 09:00 UTC daily; daily DB backup (one day of data) for instant download and reconstruction. */
export const DAILY_BACKUP_CRON_EXPRESSION = '0 9 * * *'
/** 23:59 Melbourne/Hobart local time daily; dual UTC hours cover DST and handler gates on local wall clock. */
export const HISTORICAL_QUALITY_DAILY_CRON_EXPRESSION = '59 12,13 * * *'
export const SCHEDULE_CRON_EXPRESSION = DAILY_SCHEDULE_CRON_EXPRESSION
// Hourly cron should keep attempting the active Melbourne collection date until coverage is complete.
export const DEFAULT_RATE_CHECK_INTERVAL_MINUTES = 0
export const MIN_RATE_CHECK_INTERVAL_MINUTES = 0
export const RATE_CHECK_INTERVAL_MINUTES_KEY = 'rate_check_interval_minutes'
export const RATE_CHECK_LAST_RUN_ISO_KEY = 'rate_check_last_run_iso'
/** Public Rate Report (LWC) floating legend panel opacity; stored in app_config as decimal string (e.g. 0.75). */
export const CHART_LEGEND_OPACITY_KEY = 'chart_legend_opacity'
export const CHART_LEGEND_OPACITY_DESKTOP_KEY = 'chart_legend_opacity_desktop'
export const CHART_LEGEND_OPACITY_MOBILE_KEY = 'chart_legend_opacity_mobile'
export const DEFAULT_CHART_LEGEND_OPACITY = 0.75
export const CHART_LEGEND_OPACITY_MIN = 0.05
export const CHART_LEGEND_OPACITY_MAX = 1
export const CHART_LEGEND_TEXT_BRIGHTNESS_KEY = 'chart_legend_text_brightness'
export const CHART_LEGEND_TEXT_BRIGHTNESS_DESKTOP_KEY = 'chart_legend_text_brightness_desktop'
export const CHART_LEGEND_TEXT_BRIGHTNESS_MOBILE_KEY = 'chart_legend_text_brightness_mobile'
export const DEFAULT_CHART_LEGEND_TEXT_BRIGHTNESS = 1
export const CHART_LEGEND_TEXT_BRIGHTNESS_MIN = 0.5
export const CHART_LEGEND_TEXT_BRIGHTNESS_MAX = 1.6
export const CHART_MAX_PRODUCTS_KEY = 'chart_max_products'
export const CHART_MAX_PRODUCTS_UNLIMITED = 'unlimited'
export const CHART_MAX_PRODUCTS_MIN = 1
export const CHART_MAX_PRODUCTS_MAX = 1000
/** JSON object (string in app_config) for public Rate Report ribbon (bands) styling. */
export const CHART_RIBBON_STYLE_KEY = 'chart_ribbon_style'
/** When '1'/'true'/'on', the public client consumes `snapshot.chartModels.default` and skips buildChartModel on matching scopes. Default off while the port stabilises. */
export const FEATURE_CHART_MODEL_SERVER_SIDE_KEY = 'chart_model_server_side'
export const PUBLIC_FEATURE_KEYS = [
  FEATURE_CHART_MODEL_SERVER_SIDE_KEY,
] as const
/** JSON in app_config: `{"hour":0-23,"time_zone":"IANA"}`. Served at GET /doctor-schedule for scheduled CI. */
export const DOCTOR_SCHEDULE_KEY = 'doctor_schedule'
/** Default wall-clock hour in `time_zone` when no `doctor_schedule` row exists (19 ≈ 7pm local). */
export const DEFAULT_DOCTOR_SCHEDULE_HOUR = 19
export const INGEST_PAUSE_MODE_KEY = 'ingest_pause_mode'
export const INGEST_PAUSE_REASON_KEY = 'ingest_pause_reason'
export const INGEST_PAUSE_MODES = ['active', 'repair_pause'] as const
/** Aligns with chart/KV cache windows; CDN + Cache API serve stale while Worker recomputes. */
export const DEFAULT_PUBLIC_CACHE_SECONDS = 300
/** D1 batch size for public GET /export (full dataset built from chunked SELECTs). */
export const PUBLIC_EXPORT_FETCH_CHUNK_SIZE = 1000
/** Upper bound when the client passes an explicit export `limit` query param. */
export const PUBLIC_EXPORT_MAX_EXPLICIT_LIMIT = 50_000_000
export const DEFAULT_LOCK_TTL_SECONDS = 7200
export const DEFAULT_MAX_QUEUE_ATTEMPTS = 3

export const SECURITY_PURPOSES: SecurityPurpose[] = ['owner_occupied', 'investment']
export const REPAYMENT_TYPES: RepaymentType[] = ['principal_and_interest', 'interest_only']
export const RATE_STRUCTURES: RateStructure[] = [
  'variable',
  'fixed_1yr',
  'fixed_2yr',
  'fixed_3yr',
  'fixed_4yr',
  'fixed_5yr',
]
export const LVR_TIERS: LvrTier[] = [
  'lvr_=60%',
  'lvr_60-70%',
  'lvr_70-80%',
  'lvr_80-85%',
  'lvr_85-90%',
  'lvr_90-95%',
  'lvr_unspecified',
]
export const FEATURE_SETS: FeatureSet[] = ['basic', 'premium']

export const SAVINGS_ACCOUNT_TYPES: SavingsAccountType[] = ['savings', 'transaction', 'at_call']
export const SAVINGS_RATE_TYPES: SavingsRateType[] = ['base', 'bonus', 'introductory', 'bundle', 'total']
export const INTEREST_PAYMENTS: InterestPayment[] = ['at_maturity', 'monthly', 'quarterly', 'annually']

/** Allowed data_quality_flag values; unknown flags are rejected at validation. */
export const DATA_QUALITY_FLAGS: string[] = [
  'cdr_live',
  'scraped_fallback_strict',
  'parsed_from_wayback_strict',
  'parsed_from_wayback_cdr',
  'parsed_from_wayback',
  'ok',
]

/** Allowed run_source values. */
export const RUN_SOURCES = ['scheduled', 'manual'] as const

/** Allowed retrieval_type values. */
export const RETRIEVAL_TYPES = ['historical_scrape', 'present_scrape_same_date'] as const

const lendersConfig = lendersConfigRaw as LenderConfigFile
export const TARGET_LENDERS = lendersConfig.lenders
export const CDR_REGISTER_DISCOVERY_URL = 'https://consumerdatastandardsaustralia.github.io/register/'
