import {
  normalizeBankName,
  normalizeFeatureSet,
  normalizeLvrTier,
  normalizeProductName,
  normalizeRateStructure,
  normalizeSecurityPurpose,
  parseComparisonRate,
  parseInterestRate,
  type NormalizedRateRow,
} from './normalize.js'
import {
  normalizeAccountType,
  normalizeDepositTier,
  type NormalizedSavingsRow,
} from './normalize-savings.js'
import type { LenderConfig } from '../types.js'

export const UBANK_HOME_LOAN_FALLBACK_URLS = [
  'https://www.ubank.com.au/home-loans/neat-variable-rate-home-loans',
  'https://www.ubank.com.au/home-loans/flex-variable-rate-home-loans',
  'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
]

export const UBANK_SAVINGS_FALLBACK_URLS = {
  saveOverview: 'https://www.ubank.com.au/banking/savings-account',
  saveRateHelp: 'https://www.ubank.com.au/help/current/everyday-banking/earning-interest/whats-my-current-save-account-interest-rate',
  bonusCriteriaHelp: 'https://www.ubank.com.au/help/current/everyday-banking/earning-interest/how-do-i-earn-bonus-interest',
  billsHelp: 'https://www.ubank.com.au/help/current/app-and-online-banking/bills-account/do-i-earn-interest-on-my-bills-account',
  billsOverview: 'https://www.ubank.com.au/banking/bills-account',
}

export type UbankParseResult<T> = {
  rows: T[]
  inspected: number
  dropped: number
}

type UbankHomeProductMeta = {
  productId: string
  productName: string
  productUrl: string
  featureSet: 'basic' | 'premium'
}

const UBANK_HOME_PRODUCT_META: Record<string, UbankHomeProductMeta> = {
  'neat|owner_occupied|principal_and_interest|variable': {
    productId: '11',
    productName: 'Neat Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/neat-variable-rate-home-loans',
    featureSet: 'basic',
  },
  'neat|investment|principal_and_interest|variable': {
    productId: '12',
    productName: 'Neat Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/neat-variable-rate-home-loans',
    featureSet: 'basic',
  },
  'neat|investment|interest_only|variable': {
    productId: '13',
    productName: 'Neat Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/neat-variable-rate-home-loans',
    featureSet: 'basic',
  },
  'flex|owner_occupied|principal_and_interest|variable': {
    productId: '3',
    productName: 'Flex Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-variable-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|interest_only|variable': {
    productId: '4',
    productName: 'Flex Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-variable-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|principal_and_interest|variable': {
    productId: '7',
    productName: 'Flex Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-variable-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|interest_only|variable': {
    productId: '8',
    productName: 'Flex Variable Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-variable-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|principal_and_interest|fixed_1yr': {
    productId: '5',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|principal_and_interest|fixed_2yr': {
    productId: '5',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|principal_and_interest|fixed_3yr': {
    productId: '5',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|principal_and_interest|fixed_5yr': {
    productId: '5',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|interest_only|fixed_1yr': {
    productId: '6',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|interest_only|fixed_2yr': {
    productId: '6',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|interest_only|fixed_3yr': {
    productId: '6',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|owner_occupied|interest_only|fixed_5yr': {
    productId: '6',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|principal_and_interest|fixed_1yr': {
    productId: '9',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|principal_and_interest|fixed_2yr': {
    productId: '9',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|principal_and_interest|fixed_3yr': {
    productId: '9',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|principal_and_interest|fixed_5yr': {
    productId: '9',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|interest_only|fixed_1yr': {
    productId: '10',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|interest_only|fixed_2yr': {
    productId: '10',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|interest_only|fixed_3yr': {
    productId: '10',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
  'flex|investment|interest_only|fixed_5yr': {
    productId: '10',
    productName: 'Flex Fixed Home Loan',
    productUrl: 'https://www.ubank.com.au/home-loans/flex-fixed-rate-home-loans',
    featureSet: 'premium',
  },
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripHtml(text: string): string {
  return normalizeProductName(decodeHtml(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '))
}

function stripToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function parseMoney(text: string | undefined): number | null {
  const normalized = String(text || '').replace(/[$,\s]/g, '').trim()
  if (!normalized) return null
  if (/m$/i.test(normalized)) {
    const value = Number(normalized.slice(0, -1))
    return Number.isFinite(value) ? value * 1_000_000 : null
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function normalizeUbankHomeKey(caption: string, rateStructure: string): string {
  const text = caption.toLowerCase()
  const family = text.includes('neat') ? 'neat' : 'flex'
  const purpose = text.includes('investor') ? 'investment' : 'owner_occupied'
  const repayment = text.includes(' io ') || text.endsWith(' io') || text.includes('interest only') ? 'interest_only' : 'principal_and_interest'
  return `${family}|${purpose}|${repayment}|${rateStructure}`
}

function ubankRepaymentType(caption: string): 'principal_and_interest' | 'interest_only' {
  const text = caption.toLowerCase()
  return text.includes(' io ') || text.endsWith(' io') || text.includes('interest only')
    ? 'interest_only'
    : 'principal_and_interest'
}

export function parseUbankHomeLoanRatesFromHtml(input: {
  lender: LenderConfig
  html: string
  sourceUrl: string
  collectionDate: string
  qualityFlag: string
}): UbankParseResult<NormalizedRateRow> {
  if (input.lender.code !== 'ubank') return { rows: [], inspected: 0, dropped: 0 }

  const rows: NormalizedRateRow[] = []
  const seen = new Set<string>()
  let inspected = 0
  let dropped = 0
  const tablePattern = /"tableCaption":"([^"]*home loan rates[^"]*)"[\s\S]{0,1600}?"body":(\[\[[\s\S]*?\]\])/gi

  for (const match of input.html.matchAll(tablePattern)) {
    const caption = stripHtml(match[1] || '')
    let bodyRows: string[][]
    try {
      bodyRows = JSON.parse(match[2] || '[]') as string[][]
    } catch {
      dropped += 1
      continue
    }

    for (const cells of bodyRows) {
      inspected += 1
      if (!Array.isArray(cells) || cells.length < 3) {
        dropped += 1
        continue
      }
      const label = stripHtml(cells[0] || '')
      const interestRate = parseInterestRate(cells[1] || '')
      if (interestRate == null) {
        dropped += 1
        continue
      }

      const rateStructure = normalizeRateStructure(`${caption} ${label}`)
      const meta = UBANK_HOME_PRODUCT_META[normalizeUbankHomeKey(caption, rateStructure)]
      if (!meta) {
        dropped += 1
        continue
      }

      const lvrTierText = rateStructure === 'variable' ? label : caption
      const securityPurpose = normalizeSecurityPurpose(caption)
      const repaymentType = ubankRepaymentType(caption)
      const lvrTier = normalizeLvrTier(lvrTierText).tier
      const comparisonRate = parseComparisonRate(cells[2] || '')
      const rowKey = [meta.productId, securityPurpose, repaymentType, lvrTier, rateStructure].join('|')
      if (seen.has(rowKey)) continue
      seen.add(rowKey)

      rows.push({
        bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
        collectionDate: input.collectionDate,
        productId: meta.productId,
        productName: meta.productName,
        securityPurpose,
        repaymentType,
        rateStructure,
        lvrTier,
        featureSet: normalizeFeatureSet(meta.productName, meta.featureSet === 'premium' ? 1 : null),
        interestRate,
        comparisonRate,
        annualFee: null,
        sourceUrl: input.sourceUrl,
        productUrl: meta.productUrl,
        publishedAt: null,
        dataQualityFlag: input.qualityFlag,
        confidenceScore: comparisonRate == null ? 0.965 : 0.985,
        retrievalType: 'present_scrape_same_date',
      })
    }
  }

  return { rows, inspected, dropped }
}

function currentBonusConditions(text: string): string | null {
  const normalized = stripToText(text)
  const pattern =
    /From 1 October 2025, to earn bonus interest, you['’]ll need to: Have a Spend account, and Grow your combined balance across all your Save accounts by at least \$1 each month/i
  if (!pattern.test(normalized)) return null
  return 'Have a Spend account and grow your combined Save balance by at least $1 each month.'
}

export function parseUbankSavingsRows(input: {
  lender: LenderConfig
  saveOverviewHtml: string
  saveRateHelpHtml: string
  bonusCriteriaHtml: string
  billsHelpHtml: string
  collectionDate: string
  qualityFlag: string
}): UbankParseResult<NormalizedSavingsRow> {
  if (input.lender.code !== 'ubank') return { rows: [], inspected: 0, dropped: 0 }

  const rows: NormalizedSavingsRow[] = []
  let inspected = 0
  let dropped = 0
  const bankName = normalizeBankName(input.lender.canonical_bank_name, input.lender.name)
  const bonusConditions = currentBonusConditions(input.bonusCriteriaHtml)
  const saveHelpText = stripToText(input.saveRateHelpHtml)
  const welcomeText = stripToText(input.saveOverviewHtml)
  const billsText = stripToText(input.billsHelpHtml)

  const tierPattern =
    /Tier\s+\d+\s+\$([0-9,]+(?:\.\d+)?)\s+(?:to\s+\$([0-9,]+(?:\.\d+)?)|and over)\s+N\/A\s+[0-9.]+% p\.a\.\s+([0-9.]+)% p\.a\./gi
  for (const match of saveHelpText.matchAll(tierPattern)) {
    inspected += 1
    const minBalance = parseMoney(match[1])
    const maxBalance = parseMoney(match[2])
    const interestRate = parseInterestRate(match[3])
    if (minBalance == null || interestRate == null) {
      dropped += 1
      continue
    }
    rows.push({
      bankName,
      collectionDate: input.collectionDate,
      productId: '1',
      productName: 'Save account',
      accountType: normalizeAccountType('savings'),
      rateType: 'bonus',
      interestRate,
      depositTier: normalizeDepositTier(minBalance, maxBalance),
      minBalance,
      maxBalance,
      conditions: bonusConditions,
      monthlyFee: null,
      sourceUrl: UBANK_SAVINGS_FALLBACK_URLS.saveRateHelp,
      productUrl: UBANK_SAVINGS_FALLBACK_URLS.saveOverview,
      publishedAt: null,
      dataQualityFlag: input.qualityFlag,
      confidenceScore: 0.985,
      retrievalType: 'present_scrape_same_date',
    })
  }

  const welcomeRate = parseInterestRate((input.saveOverviewHtml.match(/rateSolution[\s\S]{0,240}?([0-9]+\.[0-9]+)%/i) || [])[1] || null)
  if (welcomeRate != null) {
    inspected += 1
    rows.push({
      bankName,
      collectionDate: input.collectionDate,
      productId: '1',
      productName: 'Save account',
      accountType: normalizeAccountType('savings'),
      rateType: 'introductory',
      interestRate: welcomeRate,
      depositTier: normalizeDepositTier(0, 1_000_000),
      minBalance: 0,
      maxBalance: 1_000_000,
      conditions: 'Welcome Bonus Rate for new UBank customers.',
      monthlyFee: null,
      sourceUrl: UBANK_SAVINGS_FALLBACK_URLS.saveOverview,
      productUrl: UBANK_SAVINGS_FALLBACK_URLS.saveOverview,
      publishedAt: null,
      dataQualityFlag: input.qualityFlag,
      confidenceScore: 0.965,
      retrievalType: 'present_scrape_same_date',
    })
  }

  inspected += 1
  if (/Bills account is a transaction account and earns zero interest\./i.test(billsText)) {
    rows.push({
      bankName,
      collectionDate: input.collectionDate,
      productId: '14',
      productName: 'Bills account',
      accountType: normalizeAccountType('transaction'),
      rateType: 'base',
      interestRate: 0,
      depositTier: normalizeDepositTier(null, null),
      minBalance: null,
      maxBalance: null,
      conditions: 'Bills account is a transaction account and earns zero interest.',
      monthlyFee: null,
      sourceUrl: UBANK_SAVINGS_FALLBACK_URLS.billsHelp,
      productUrl: UBANK_SAVINGS_FALLBACK_URLS.billsOverview,
      publishedAt: null,
      dataQualityFlag: input.qualityFlag,
      confidenceScore: 0.99,
      retrievalType: 'present_scrape_same_date',
    })
  } else {
    dropped += 1
  }

  return { rows, inspected, dropped }
}
