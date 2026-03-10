import {
  normalizeBankName,
  normalizeFeatureSet,
  normalizeLvrTier,
  normalizeProductName,
  normalizeRateStructure,
  normalizeRepaymentType,
  normalizeSecurityPurpose,
  parseAnnualFee,
  parseComparisonRate,
  parseInterestRate,
  isProductNameLikelyRateProduct,
  type NormalizedRateRow,
} from '../normalize.js'
import { getLenderPlaybook } from '../lender-playbooks.js'
import type { LenderConfig } from '../../types.js'
import { productUrlFromDetail, publishedAtFromDetail } from './detail-metadata.js'
import { asArray, getText, isRecord, pickText, type JsonRecord } from './primitives.js'

export function isResidentialMortgage(product: JsonRecord): boolean {
  const category = pickText(product, ['productCategory', 'category', 'type']).toUpperCase()
  const name = pickText(product, ['name', 'productName']).toUpperCase()
  return category.includes('MORTGAGE') || name.includes('MORTGAGE') || name.includes('HOME LOAN')
}

function extractRatesArray(detail: JsonRecord): JsonRecord[] {
  const arrays = [detail.lendingRates, detail.rates, detail.rateTiers, detail.rate]
  for (const candidate of arrays) {
    const arr = asArray(candidate).filter(isRecord)
    if (arr.length > 0) return arr
  }
  return []
}

function collectConstraintText(rate: JsonRecord, detail: JsonRecord): string {
  const fromRate = [pickText(rate, ['additionalInfo', 'additionalValue', 'name', 'lendingRateType'])]
  const constraints = asArray(rate.constraints).filter(isRecord)
  for (const c of constraints) {
    fromRate.push(JSON.stringify(c))
  }
  const detailHints = [pickText(detail, ['description', 'name', 'productName'])]
  return [...fromRate, ...detailHints].filter(Boolean).join(' | ')
}

function parseLvrFromText(text: string): { min: number | null; max: number | null } | null {
  const t = text.toLowerCase()
  if (!t.includes('lvr') && !t.includes('loan to value') && !t.includes('ltv')) return null

  const range = t.match(/(\d{1,3}(?:\.\d+)?)\s*(?:%\s*)?(?:-|to)\s*(\d{1,3}(?:\.\d+)?)\s*%?/)
  if (range) {
    const lo = Number(range[1])
    const hi = Number(range[2])
    if (Number.isFinite(lo) && Number.isFinite(hi)) return { min: lo, max: hi }
  }

  const le = t.match(/(?:<=|â‰¤|under|up to|maximum|max|below)\s*(\d{1,3}(?:\.\d+)?)\s*%?/)
  if (le) {
    const hi = Number(le[1])
    if (Number.isFinite(hi)) return { min: null, max: hi }
  }

  const ge = t.match(/(?:>=|â‰¥|over|above|from|greater than)\s*(\d{1,3}(?:\.\d+)?)\s*%?/)
  if (ge) {
    const lo = Number(ge[1])
    if (Number.isFinite(lo)) return { min: lo, max: null }
  }

  const single = t.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
  if (single) {
    const n = Number(single[1])
    if (Number.isFinite(n) && n <= 100) return { min: null, max: n }
  }

  return null
}

function parseLvrBounds(rate: JsonRecord): { min: number | null; max: number | null } {
  const constraints = asArray(rate.constraints).filter(isRecord)
  for (const c of constraints) {
    const t = pickText(c, ['constraintType']).toLowerCase()
    if (!t.includes('lvr')) continue
    const min = Number.isFinite(Number(c.minValue)) ? Number(c.minValue) : null
    const max = Number.isFinite(Number(c.maxValue)) ? Number(c.maxValue) : null
    if (min != null || max != null) return { min, max }
  }

  const tiers = asArray(rate.tiers).filter(isRecord)
  for (const tier of tiers) {
    const tierName = pickText(tier, ['name', 'unitOfMeasure', 'rateApplicationMethod']).toLowerCase()
    if (!tierName.includes('lvr') && !tierName.includes('loan to value')) continue
    const min = Number.isFinite(Number(tier.minimumValue)) ? Number(tier.minimumValue) : null
    const max = Number.isFinite(Number(tier.maximumValue)) ? Number(tier.maximumValue) : null
    if (min != null || max != null) return { min, max }
  }

  const additionalValue = getText(rate.additionalValue)
  if (additionalValue) {
    const fromAdditional = parseLvrFromText(additionalValue)
    if (fromAdditional) return fromAdditional
  }

  const additionalInfo = getText(rate.additionalInfo)
  if (additionalInfo) {
    const fromInfo = parseLvrFromText(additionalInfo)
    if (fromInfo) return fromInfo
  }

  return { min: null, max: null }
}

function parseAnnualFeeFromDetail(detail: JsonRecord): number | null {
  const fees = asArray(detail.fees).filter(isRecord)
  for (const fee of fees) {
    const feeText = `${pickText(fee, ['feeType'])} ${pickText(fee, ['name'])} ${pickText(fee, ['additionalInfo'])}`.toLowerCase()
    if (!feeText.includes('annual') && !feeText.includes('package')) {
      continue
    }
    const fixedAmount = isRecord(fee.fixedAmount) ? fee.fixedAmount : null
    const additionalValue = getText(fee.additionalValue)
    const amount =
      parseAnnualFee(fee.amount) ??
      parseAnnualFee(fixedAmount ? fixedAmount.amount : null) ??
      (/^p\d/i.test(additionalValue) ? null : parseAnnualFee(additionalValue))
    if (amount != null) {
      return amount
    }
  }
  return null
}

export function parseRatesFromDetail(input: {
  lender: LenderConfig
  detail: JsonRecord
  sourceUrl: string
  collectionDate: string
}): NormalizedRateRow[] {
  const detail = input.detail
  const productId = pickText(detail, ['productId', 'id'])
  const productName = normalizeProductName(pickText(detail, ['name', 'productName']))
  const isLikelyMortgageProduct = isResidentialMortgage(detail) || isProductNameLikelyRateProduct(productName)
  if (!productId || !productName || !isLikelyMortgageProduct) {
    return []
  }
  const rates = extractRatesArray(detail)
  const annualFee = parseAnnualFeeFromDetail(detail)
  const productUrl = productUrlFromDetail(detail, input.sourceUrl)
  const publishedAt = publishedAtFromDetail(detail)
  const result: NormalizedRateRow[] = []
  const playbook = getLenderPlaybook(input.lender)

  for (const rate of rates) {
    const rawInterestValue = rate.rate ?? rate.interestRate ?? rate.value
    const interestRate = parseInterestRate(rawInterestValue)
    if (interestRate == null) {
      continue
    }
    if (interestRate < playbook.minRatePercent || interestRate > playbook.maxRatePercent) {
      continue
    }
    const comparisonRate = parseComparisonRate(rate.comparisonRate ?? rate.comparison ?? rate.comparison_value)
    const contextText = collectConstraintText(rate, detail)
    const lvr = parseLvrBounds(rate)
    const contextLower = contextText.toLowerCase()

    const lvrResult = normalizeLvrTier(contextText, lvr.min, lvr.max)

    let confidence = 0.95
    if (!comparisonRate) confidence -= 0.04
    if (lvrResult.wasDefault) confidence -= 0.05
    if (!contextLower.includes('loan')) confidence -= 0.02

    const lendingRateType = pickText(rate, ['lendingRateType'])
    const repaymentText = `${lendingRateType} ${pickText(rate, ['repaymentType'])} ${pickText(detail, ['repaymentType'])} ${contextText}`
    const rateStructureText = `${lendingRateType} ${pickText(rate, ['name'])} ${pickText(detail, ['name'])} ${contextText}`

    const rawPurpose = `${pickText(rate, ['loanPurpose'])} ${pickText(detail, ['loanPurpose'])}`.toLowerCase()
    const isBothPurpose = rawPurpose.includes('both')
    const purposes: Array<'owner_occupied' | 'investment'> = isBothPurpose
      ? ['owner_occupied', 'investment']
      : [normalizeSecurityPurpose(`${rawPurpose} ${contextText}`)]

    for (const securityPurpose of purposes) {
      const row: NormalizedRateRow = {
        bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
        collectionDate: input.collectionDate,
        productId,
        productName,
        securityPurpose,
        repaymentType: normalizeRepaymentType(repaymentText),
        rateStructure: normalizeRateStructure(rateStructureText),
        lvrTier: lvrResult.tier,
        featureSet: normalizeFeatureSet(`${productName} ${contextText}`, annualFee),
        interestRate,
        comparisonRate,
        annualFee,
        sourceUrl: input.sourceUrl,
        productUrl,
        publishedAt,
        dataQualityFlag: 'cdr_live',
        confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3)),
        retrievalType: 'present_scrape_same_date',
      }
      result.push(row)
    }
  }

  return result
}
