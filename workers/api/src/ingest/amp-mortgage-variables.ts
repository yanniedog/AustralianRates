import type { LenderConfig, LvrTier, RateStructure, RepaymentType, SecurityPurpose } from '../types'
import { getLenderPlaybook } from './lender-playbooks'
import {
  normalizeBankName,
  normalizeFeatureSet,
  normalizeProductName,
  parseComparisonRate,
  parseInterestRate,
  type NormalizedRateRow,
} from './normalize'

export const AMP_MORTGAGE_VARIABLES_URL = 'https://www.amp.com.au/graphql/execute.json/amp-2024/variables'

export type AmpMortgageVariablesParseResult = {
  rows: NormalizedRateRow[]
  inspected: number
  dropped: number
  deduped: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function variableValueMap(payload: unknown): Map<string, string> {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const variableList = asRecord(data?.variableList)
  const items = Array.isArray(variableList?.items) ? variableList.items : []
  const values = new Map<string, string>()
  for (const item of items) {
    const record = asRecord(item)
    const key = typeof record?.key === 'string' ? record.key.trim() : ''
    const value = asRecord(record?.value)
    const plaintext = typeof value?.plaintext === 'string' ? value.plaintext.replace(/\s+/g, ' ').trim() : ''
    if (!key || !plaintext) continue
    values.set(key, plaintext)
  }
  return values
}

function isAmpMortgageBase(base: string): boolean {
  return /^(pro_pack|prof_loc|essential|land_|amp_first|superedge_variable)/.test(base)
}

function inferSecurityPurpose(base: string): SecurityPurpose | null {
  if (/(?:^|_)inv(?:_|$)/.test(base)) return 'investment'
  if (/(?:^|_)oo(?:_|$)/.test(base)) return 'owner_occupied'
  return null
}

function inferRepaymentType(base: string): RepaymentType | null {
  if (/(?:^|_)p_i(?:_|$)/.test(base)) return 'principal_and_interest'
  if (/(?:^|_)io(?:_|$)/.test(base)) return 'interest_only'
  return null
}

function inferRateStructure(base: string): RateStructure {
  if (base.includes('1yr_fixed')) return 'fixed_1yr'
  if (base.includes('2yr_fixed')) return 'fixed_2yr'
  if (base.includes('3yr_fixed')) return 'fixed_3yr'
  if (base.includes('4yr_fixed')) return 'fixed_4yr'
  if (base.includes('5yr_fixed')) return 'fixed_5yr'
  return 'variable'
}

function inferLvrTier(base: string): LvrTier {
  if (/gt80_to_lteg90/.test(base)) return 'lvr_85-90%'
  if (/gt70_to_lteg80|gt70_lteg_80/.test(base)) return 'lvr_70-80%'
  if (/gt60_to_lteg70|gt60_lteg_70/.test(base)) return 'lvr_60-70%'
  if (/gt50_to_lteg60|gt50_lteg_60|lteg50|lteg_50|lteg60|lteg_60/.test(base)) return 'lvr_=60%'
  return 'lvr_80-85%'
}

function amountBandLabel(base: string): string | null {
  if (/(?:^|_)gt_?1m(?:_|$)/.test(base)) return '$1,000,000+'
  if (/(?:^|_)gt_?500k(?:_|$)/.test(base)) return '$500,000 to <$1,000,000'
  if (/(?:^|_)lt_?500k(?:_|$)/.test(base)) return '$100,000 to <$500,000'
  if (base.includes('gteq_750k')) return '$750,000+'
  if (base.includes('gteq_250k_lt_750k')) return '$250,000 to <$750,000'
  return null
}

function productFamily(base: string): string | null {
  if (base.startsWith('prof_loc')) return 'Professional Package Line of Credit'
  if (base.startsWith('pro_pack_10yr_io')) return 'Professional Package 10 Year IO'
  if (base.startsWith('pro_pack_construction')) return 'Professional Package Construction'
  if (base.startsWith('pro_pack')) return 'Professional Package'
  if (base.startsWith('essential')) return 'AMP Essential Home Loan'
  if (base.startsWith('land_')) return 'Land Loan'
  if (base.startsWith('amp_firstloc')) return 'AMP First Home Loan Line of Credit'
  if (base.startsWith('amp_first_construction')) return 'AMP First Home Loan Construction'
  if (base.startsWith('amp_first')) return 'AMP First Home Loan'
  if (base.startsWith('superedge_variable')) return 'SMSF Loan'
  return null
}

function buildProductName(base: string): string | null {
  const family = productFamily(base)
  if (!family) return null
  const parts = [family]
  const amountBand = amountBandLabel(base)
  if (amountBand) parts.push(amountBand)
  return normalizeProductName(parts.join(' - '))
}

function comparisonValue(values: Map<string, string>, base: string): string | null {
  return values.get(`${base}_comparision`) ?? values.get(`${base}_comparison`) ?? null
}

function dedupePreference(base: string): number {
  if (base.includes('_to_')) return 0
  if (base.includes('lteg')) return 1
  return 2
}

function dedupeKey(row: Omit<NormalizedRateRow, 'productId'>): string {
  return [
    row.productName,
    row.securityPurpose,
    row.repaymentType,
    row.rateStructure,
    row.lvrTier,
    row.featureSet,
    row.interestRate,
    row.comparisonRate ?? '',
  ].join('|')
}

export function parseAmpMortgageVariables(input: {
  lender: LenderConfig
  payload: unknown
  sourceUrl: string
  collectionDate: string
  qualityFlag: string
}): AmpMortgageVariablesParseResult {
  const playbook = getLenderPlaybook(input.lender)
  const values = variableValueMap(input.payload)
  const candidates: Array<{ base: string; row: Omit<NormalizedRateRow, 'productId'> }> = []
  let inspected = 0
  let dropped = 0

  for (const [key, rawInterest] of values.entries()) {
    if (!key.endsWith('_interest') || key.endsWith('_interest_linked')) continue
    const base = key.slice(0, -'_interest'.length)
    if (!isAmpMortgageBase(base)) continue
    inspected += 1

    const productName = buildProductName(base)
    const securityPurpose = inferSecurityPurpose(base)
    const repaymentType = inferRepaymentType(base)
    const interestRate = parseInterestRate(rawInterest)
    if (!productName || !securityPurpose || !repaymentType || interestRate == null) {
      dropped += 1
      continue
    }
    if (interestRate < playbook.minRatePercent || interestRate > playbook.maxRatePercent) {
      dropped += 1
      continue
    }

    const comparisonRate = parseComparisonRate(comparisonValue(values, base))
    const featureSet = normalizeFeatureSet(productName, null)
    candidates.push({
      base,
      row: {
        bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
        collectionDate: input.collectionDate,
        productName,
        securityPurpose,
        repaymentType,
        rateStructure: inferRateStructure(base),
        lvrTier: inferLvrTier(base),
        featureSet,
        interestRate,
        comparisonRate,
        annualFee: null,
        sourceUrl: input.sourceUrl,
        productUrl: input.sourceUrl,
        publishedAt: null,
        dataQualityFlag: input.qualityFlag,
        confidenceScore: comparisonRate == null ? 0.98 : 0.985,
        retrievalType: 'present_scrape_same_date',
      },
    })
  }

  candidates.sort((a, b) => {
    const rank = dedupePreference(a.base) - dedupePreference(b.base)
    if (rank !== 0) return rank
    return a.base.localeCompare(b.base)
  })

  const rows: NormalizedRateRow[] = []
  const seen = new Set<string>()
  let deduped = 0
  for (const candidate of candidates) {
    const key = dedupeKey(candidate.row)
    if (seen.has(key)) {
      deduped += 1
      continue
    }
    seen.add(key)
    rows.push({
      ...candidate.row,
      productId: `amp-variable-${candidate.base}`,
    })
  }

  return {
    rows,
    inspected,
    dropped: dropped + deduped,
    deduped,
  }
}
