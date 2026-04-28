import { asArray, isRecord, pickText, type JsonRecord } from './primitives.js'

export type CdrDatasetKind = 'home_loans' | 'savings' | 'term_deposits'

const DATASET_CATEGORY_ALIASES: Record<CdrDatasetKind, string[]> = {
  home_loans: [
    'RESIDENTIAL_MORTGAGES',
    'RESIDENTIAL_MORTGAGE',
    'MORTGAGES',
    'MORTGAGE',
    'HOME_LOANS',
    'HOME_LOAN',
  ],
  savings: [
    'TRANS_AND_SAVINGS_ACCOUNTS',
    'TRANS_AND_SAVINGS_ACCOUNT',
    'TRANS_AND_SAVINGS',
    'SAVINGS_ACCOUNTS',
    'SAVINGS_ACCOUNT',
    'SAVINGS',
    'TRANSACTION_AND_SAVINGS_ACCOUNTS',
  ],
  term_deposits: [
    'TERM_DEPOSITS',
    'TERM_DEPOSIT',
    'FIXED_TERM_DEPOSITS',
    'FIXED_TERM_DEPOSIT',
    'FIXED_DEPOSITS',
    'FIXED_DEPOSIT',
  ],
}

function asText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeCategoryToken(value: string): string {
  return asText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function normalizeCdrProductCategory(value: unknown): string | null {
  const token = normalizeCategoryToken(asText(value))
  return token || null
}

export function extractCdrProductCategory(product: JsonRecord): string | null {
  const raw = pickText(product, ['productCategory', 'category', 'type'])
  return normalizeCdrProductCategory(raw)
}

export function parseCdrProductCategoryFromJson(json: string | null | undefined): string | null {
  const text = asText(json)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) return null
    const detail = isRecord(parsed.data) ? parsed.data : parsed
    return normalizeCdrProductCategory(detail.productCategory ?? detail.category ?? detail.type ?? '')
  } catch {
    return null
  }
}

export function datasetFromCdrCategory(category: string | null): CdrDatasetKind | null {
  const normalized = normalizeCdrProductCategory(category)
  if (!normalized) return null
  for (const dataset of Object.keys(DATASET_CATEGORY_ALIASES) as CdrDatasetKind[]) {
    if (DATASET_CATEGORY_ALIASES[dataset].includes(normalized)) return dataset
  }
  if (normalized.includes('MORTGAGE') || normalized.includes('HOME_LOAN')) return 'home_loans'
  if (normalized.includes('TERM_DEPOSIT') || normalized.includes('FIXED_DEPOSIT')) return 'term_deposits'
  if (normalized.includes('SAVINGS') || normalized.includes('TRANS_AND_SAVINGS')) return 'savings'
  return null
}

function hasMortgageStructuredSignals(product: JsonRecord): boolean {
  const rates = asArray(product.lendingRates).filter(isRecord)
  if (rates.length === 0) return false
  return rates.some((rate) => {
    const loanPurpose = pickText(rate, ['loanPurpose'])
    const repaymentType = pickText(rate, ['repaymentType'])
    const lendingRateType = pickText(rate, ['lendingRateType'])
    return Boolean(loanPurpose || repaymentType || lendingRateType)
  })
}

function hasDepositStructuredSignals(product: JsonRecord): boolean {
  const depositRates = asArray(product.depositRates).filter(isRecord)
  if (depositRates.length > 0) return true
  const genericRates = asArray(product.rates).filter(isRecord)
  return genericRates.some((rate) => {
    const depositRateType = pickText(rate, ['depositRateType', 'rateType'])
    const applicationType = pickText(rate, ['applicationType', 'rateApplicabilityType'])
    return Boolean(depositRateType || applicationType)
  })
}

function inferDatasetFromStructuredSignals(product: JsonRecord): CdrDatasetKind | null {
  if (hasMortgageStructuredSignals(product)) return 'home_loans'
  if (hasDepositStructuredSignals(product)) {
    const categoryDataset = datasetFromCdrCategory(extractCdrProductCategory(product))
    if (categoryDataset) return categoryDataset
    return 'savings'
  }
  return null
}

function inferDatasetFromName(product: JsonRecord): CdrDatasetKind | null {
  const name = pickText(product, ['name', 'productName']).toUpperCase()
  if (!name) return null
  if (name.includes('MORTGAGE') || name.includes('HOME LOAN')) return 'home_loans'
  if (name.includes('TERM DEPOSIT') || name.includes('FIXED DEPOSIT')) return 'term_deposits'
  if (name.includes('SAVINGS') || name.includes('SAVER') || name.includes('AT CALL')) return 'savings'
  return null
}

export function inferCdrDataset(
  product: JsonRecord,
  options?: { allowNameFallback?: boolean },
): CdrDatasetKind | null {
  const categoryDataset = datasetFromCdrCategory(extractCdrProductCategory(product))
  if (categoryDataset) return categoryDataset
  const structuredDataset = inferDatasetFromStructuredSignals(product)
  if (structuredDataset) return structuredDataset
  if (options?.allowNameFallback === false) return null
  return inferDatasetFromName(product)
}

export function cdrCategoryMatchesDataset(
  category: string | null,
  dataset: CdrDatasetKind,
): boolean {
  return datasetFromCdrCategory(category) === dataset
}

export function isCdrHomeLoanProduct(product: JsonRecord, options?: { allowNameFallback?: boolean }): boolean {
  return inferCdrDataset(product, options) === 'home_loans'
}

export function isCdrSavingsProduct(product: JsonRecord, options?: { allowNameFallback?: boolean }): boolean {
  return inferCdrDataset(product, options) === 'savings'
}

export function isCdrTermDepositProduct(product: JsonRecord, options?: { allowNameFallback?: boolean }): boolean {
  return inferCdrDataset(product, options) === 'term_deposits'
}
