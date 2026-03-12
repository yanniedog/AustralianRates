import { sha256HexFromJson } from '../../utils/hash'

type BaseState = {
  productName: string
  sourceUrl: string
  productUrl?: string | null
  publishedAt?: string | null
  dataQualityFlag: string
  confidenceScore: number
  retrievalType: string
  isRemoved?: boolean
  removedAt?: string | null
}

type HomeLoanState = BaseState & {
  securityPurpose: string
  repaymentType: string
  rateStructure: string
  lvrTier: string
  featureSet: string
  interestRate: number
  comparisonRate?: number | null
  annualFee?: number | null
}

type SavingsState = BaseState & {
  accountType: string
  rateType: string
  depositTier: string
  interestRate: number
  minBalance?: number | null
  maxBalance?: number | null
  conditions?: string | null
  monthlyFee?: number | null
}

type TdState = BaseState & {
  termMonths: number
  depositTier: string
  interestPayment: string
  interestRate: number
  minDeposit?: number | null
  maxDeposit?: number | null
}

function normalizeBaseState(input: BaseState) {
  return {
    product_name: String(input.productName || '').trim(),
    source_url: String(input.sourceUrl || '').trim(),
    product_url: input.productUrl ? String(input.productUrl).trim() : null,
    published_at: input.publishedAt ? String(input.publishedAt).trim() : null,
    data_quality_flag: String(input.dataQualityFlag || '').trim(),
    confidence_score: Number(input.confidenceScore),
    retrieval_type: String(input.retrievalType || '').trim(),
    is_removed: input.isRemoved ? 1 : 0,
    removed_at: input.removedAt ? String(input.removedAt).trim() : null,
  }
}

export async function hashHomeLoanState(input: HomeLoanState): Promise<string> {
  return sha256HexFromJson({
    ...normalizeBaseState(input),
    security_purpose: String(input.securityPurpose || '').trim(),
    repayment_type: String(input.repaymentType || '').trim(),
    rate_structure: String(input.rateStructure || '').trim(),
    lvr_tier: String(input.lvrTier || '').trim(),
    feature_set: String(input.featureSet || '').trim(),
    interest_rate: Number(input.interestRate),
    comparison_rate: input.comparisonRate ?? null,
    annual_fee: input.annualFee ?? null,
  })
}

export async function hashSavingsState(input: SavingsState): Promise<string> {
  return sha256HexFromJson({
    ...normalizeBaseState(input),
    account_type: String(input.accountType || '').trim(),
    rate_type: String(input.rateType || '').trim(),
    deposit_tier: String(input.depositTier || '').trim(),
    interest_rate: Number(input.interestRate),
    min_balance: input.minBalance ?? null,
    max_balance: input.maxBalance ?? null,
    conditions: input.conditions ?? null,
    monthly_fee: input.monthlyFee ?? null,
  })
}

export async function hashTdState(input: TdState): Promise<string> {
  return sha256HexFromJson({
    ...normalizeBaseState(input),
    term_months: Number(input.termMonths),
    deposit_tier: String(input.depositTier || '').trim(),
    interest_payment: String(input.interestPayment || '').trim(),
    interest_rate: Number(input.interestRate),
    min_deposit: input.minDeposit ?? null,
    max_deposit: input.maxDeposit ?? null,
  })
}
