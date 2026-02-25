import type { LenderConfig } from '../types'
import { getLenderPlaybook } from './lender-playbooks'
import {
  normalizeBankName,
  normalizeFeatureSet,
  normalizeLvrTier,
  normalizeProductName,
  normalizeRateStructure,
  normalizeRepaymentType,
  normalizeSecurityPurpose,
  parseComparisonRate,
  parseInterestRate,
  isProductNameLikelyRateProduct,
  type NormalizedRateRow,
} from './normalize'

type ParseMode = 'daily' | 'historical'

export type HtmlParseResult = {
  rows: NormalizedRateRow[]
  inspected: number
  dropped: number
}

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0
  }
  return h
}

function cleanHtmlToLines(html: string): string[] {
  const marked = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(tr|li|p|br|div|td|th|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/(tr|li|p|div|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')

  return marked
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4)
}

function parseRatesFromText(text: string): { rates: number[]; comparisonRate: number | null } {
  const numericTokens = Array.from(text.matchAll(/\b(\d{1,2}(?:\.\d{1,3})?)\s*%/g)).map((m) => m[1])
  const parsed = numericTokens
    .map((token) => parseInterestRate(`${token}%`))
    .filter((x): x is number => x != null)

  if (parsed.length === 0) {
    return { rates: [], comparisonRate: null }
  }

  // Comparison rate is often explicitly labeled and appears as a second percentage.
  const hasComparisonLabel = /comparison\s+rate/i.test(text)
  const comparisonRate = hasComparisonLabel && parsed.length > 1 ? parseComparisonRate(`${parsed[1]}%`) : null
  return {
    rates: [parsed[0]],
    comparisonRate,
  }
}

function isExcluded(text: string, excludes: string[]): boolean {
  const t = text.toLowerCase()
  return excludes.some((x) => t.includes(x))
}

function hasIncludeSignal(text: string, includes: string[]): boolean {
  const t = text.toLowerCase()
  if (includes.some((x) => t.includes(x))) return true
  return t.includes('rate')
}

function buildProductName(currentLine: string, previousLine: string): string {
  const stripped = currentLine
    .replace(/\b\d{1,2}(?:\.\d{1,3})?\s*%/g, ' ')
    .replace(/comparison\s+rate/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const primary = normalizeProductName(stripped)
  if (isProductNameLikelyRateProduct(primary)) {
    return primary
  }
  return normalizeProductName(`${previousLine} ${primary}`)
}

export function extractLenderRatesFromHtml(input: {
  lender: LenderConfig
  html: string
  sourceUrl: string
  collectionDate: string
  mode: ParseMode
  qualityFlag: string
}): HtmlParseResult {
  const playbook = getLenderPlaybook(input.lender)
  const lines = cleanHtmlToLines(input.html)
  const rows: NormalizedRateRow[] = []
  const seen = new Set<string>()
  let dropped = 0
  let inspected = 0

  for (let i = 0; i < lines.length; i += 1) {
    const previous = i > 0 ? lines[i - 1] : ''
    const current = lines[i]
    const context = `${previous} ${current}`.trim()

    if (!hasIncludeSignal(context, playbook.includeKeywords)) continue
    if (isExcluded(context, playbook.excludeKeywords)) continue

    inspected += 1
    const parsed = parseRatesFromText(context)
    if (parsed.rates.length === 0) {
      dropped += 1
      continue
    }

    const interestRate = parsed.rates[0]
    if (interestRate < playbook.minRatePercent || interestRate > playbook.maxRatePercent) {
      dropped += 1
      continue
    }

    const productName = buildProductName(current, previous)
    if (!isProductNameLikelyRateProduct(productName)) {
      dropped += 1
      continue
    }

    let confidence = input.mode === 'daily' ? 0.94 : 0.86
    if (!/rate/i.test(context)) confidence -= 0.05
    if (/comparison\s+rate/i.test(context)) confidence += 0.01
    if (!playbook.includeKeywords.some((x) => context.toLowerCase().includes(x))) confidence -= 0.08

    const minConfidence = input.mode === 'daily' ? playbook.dailyMinConfidence : playbook.historicalMinConfidence
    if (confidence < minConfidence) {
      dropped += 1
      continue
    }

    const securityPurpose = normalizeSecurityPurpose(context)
    const repaymentType = normalizeRepaymentType(context)
    const rateStructure = normalizeRateStructure(context)
    const lvrResult = normalizeLvrTier(context)
    if (lvrResult.wasDefault) confidence -= 0.03
    const featureSet = normalizeFeatureSet(productName, null)
    const productId = `${input.lender.code}-html-${Math.abs(hashString(`${productName}|${rateStructure}|${lvrResult.tier}`))}`
    const rowKey = `${productId}|${input.collectionDate}|${interestRate}`
    if (seen.has(rowKey)) continue
    seen.add(rowKey)

    rows.push({
      bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
      collectionDate: input.collectionDate,
      productId,
      productName,
      securityPurpose,
      repaymentType,
      rateStructure,
      lvrTier: lvrResult.tier,
      featureSet,
      interestRate,
      comparisonRate: parsed.comparisonRate,
      annualFee: null,
      sourceUrl: input.sourceUrl,
      productUrl: input.sourceUrl,
      publishedAt: null,
      dataQualityFlag: input.qualityFlag,
      confidenceScore: Number(confidence.toFixed(3)),
      retrievalType: input.mode === 'historical' ? 'historical_scrape' : 'present_scrape_same_date',
    })
  }

  return { rows, inspected, dropped }
}
