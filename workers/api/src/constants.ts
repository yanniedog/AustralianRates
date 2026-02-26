import lendersConfigRaw from '../config/lenders.json'
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
} from './types'

export const API_BASE_PATH = '/api/home-loan-rates'
export const SAVINGS_API_BASE_PATH = '/api/savings-rates'
export const TD_API_BASE_PATH = '/api/term-deposit-rates'
export const MELBOURNE_TIMEZONE = 'Australia/Melbourne'
export const MELBOURNE_TARGET_HOUR = 6
export const DAILY_SCHEDULE_CRON_EXPRESSION = '5 * * * *'
export const HOURLY_WAYBACK_CRON_EXPRESSION = '0 * * * *'
export const SCHEDULE_CRON_EXPRESSION = DAILY_SCHEDULE_CRON_EXPRESSION
export const DEFAULT_RATE_CHECK_INTERVAL_MINUTES = 60
export const MIN_RATE_CHECK_INTERVAL_MINUTES = 60
export const RATE_CHECK_INTERVAL_MINUTES_KEY = 'rate_check_interval_minutes'
export const RATE_CHECK_LAST_RUN_ISO_KEY = 'rate_check_last_run_iso'
export const DEFAULT_PUBLIC_CACHE_SECONDS = 120
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
export const LVR_TIERS: LvrTier[] = ['lvr_=60%', 'lvr_60-70%', 'lvr_70-80%', 'lvr_80-85%', 'lvr_85-90%', 'lvr_90-95%']
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
