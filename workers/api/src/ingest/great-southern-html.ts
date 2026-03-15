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
  type NormalizedRateRow,
} from './normalize.js'
import type { LenderConfig } from '../types.js'

export type GreatSouthernHtmlParseResult = {
  rows: NormalizedRateRow[]
  inspected: number
  dropped: number
}

type ParsedRateCell = {
  purpose: string
  rawType: string
  interestRate: number | null
}

const PRODUCT_URLS: Record<string, string> = {
  'basic variable home loan': 'https://www.greatsouthernbank.com.au/home-loans/basic-variable',
  'offset variable home loan': 'https://www.greatsouthernbank.com.au/home-loans/offset-variable',
  'fixed rate home loan': 'https://www.greatsouthernbank.com.au/home-loans/fixed-rate',
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function findBalancedDiv(html: string, startIndex: number): { html: string; endIndex: number } | null {
  if (startIndex < 0 || !html.slice(startIndex).startsWith('<div')) return null
  const token = /<div\b|<\/div>/gi
  token.lastIndex = startIndex
  let depth = 0
  while (true) {
    const match = token.exec(html)
    if (!match) break
    if (match[0] === '<div') {
      depth += 1
    } else {
      depth -= 1
      if (depth === 0) {
        return {
          html: html.slice(startIndex, token.lastIndex),
          endIndex: token.lastIndex,
        }
      }
    }
  }
  return null
}

function findNextDivByClass(html: string, className: string, fromIndex: number): { html: string; startIndex: number; endIndex: number } | null {
  const pattern = new RegExp(`<div[^>]*class="[^"]*${className}[^"]*"[^>]*>`, 'i')
  const slice = html.slice(fromIndex)
  const match = pattern.exec(slice)
  if (!match || match.index == null) return null
  const startIndex = fromIndex + match.index
  const block = findBalancedDiv(html, startIndex)
  if (!block) return null
  return {
    html: block.html,
    startIndex,
    endIndex: block.endIndex,
  }
}

function findAllDivsByClass(html: string, className: string): string[] {
  const blocks: string[] = []
  let cursor = 0
  while (cursor < html.length) {
    const block = findNextDivByClass(html, className, cursor)
    if (!block) break
    blocks.push(block.html)
    cursor = block.endIndex
  }
  return blocks
}

function attrValue(attrs: string, name: string): string {
  const pattern = new RegExp(`${name}="([^"]*)"`, 'i')
  const match = pattern.exec(attrs)
  return match?.[1]?.trim() || ''
}

function parseRateCells(cellHtml: string): ParsedRateCell[] {
  const results: ParsedRateCell[] = []
  const pattern = /<div[^>]*class="[^"]*rates-module_rate[^"]*"([^>]*)>([\s\S]*?)<\/div>/gi
  for (const match of cellHtml.matchAll(pattern)) {
    const attrs = match[1] || ''
    const purpose = attrValue(attrs, 'data-purpose')
    const rawType = attrValue(attrs, 'data-type')
    const interestRate = parseInterestRate(stripHtml(match[2] || ''))
    if (!purpose || !rawType) continue
    results.push({ purpose, rawType, interestRate })
  }
  return results
}

function productUrlForTitle(title: string, fallback: string): string {
  return PRODUCT_URLS[title.toLowerCase()] || fallback
}

export function parseGreatSouthernHomeLoanRatesFromHtml(input: {
  lender: LenderConfig
  html: string
  sourceUrl: string
  collectionDate: string
  qualityFlag: string
}): GreatSouthernHtmlParseResult {
  if (input.lender.code !== 'great_southern') {
    return { rows: [], inspected: 0, dropped: 0 }
  }

  const rows: NormalizedRateRow[] = []
  const seen = new Set<string>()
  let inspected = 0
  let dropped = 0
  const headingPattern = /<h3[^>]*class="[^"]*rates-module_h3[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi
  const headingMatches = Array.from(input.html.matchAll(headingPattern))

  for (const [index, match] of headingMatches.entries()) {
    const title = stripHtml(match[1] || '')
    if (!title.toLowerCase().includes('home loan')) continue

    const headingEnd = (match.index ?? 0) + match[0].length
    const nextHeadingIndex = headingMatches[index + 1]?.index ?? input.html.length
    const tableBlock = findNextDivByClass(input.html, 'rates-module_table', headingEnd)
    if (!tableBlock || tableBlock.startIndex > nextHeadingIndex) continue

    const rowBlocks = findAllDivsByClass(tableBlock.html, 'rates-module_tr')
    for (const rowBlock of rowBlocks) {
      const cells = findAllDivsByClass(rowBlock, 'rates-module_td')
      if (cells.length < 2) continue
      const lvrOrTermLabel = stripHtml(cells[0])
      const interestCells = parseRateCells(cells[1])
      const comparisonCells = cells.length > 2 ? parseRateCells(cells[2]) : []
      const comparisonMap = new Map(
        comparisonCells.map((cell) => [`${cell.purpose}|${cell.rawType}`, cell.interestRate]),
      )

      for (const rateCell of interestCells) {
        inspected += 1
        if (rateCell.interestRate == null) {
          dropped += 1
          continue
        }
        if (rateCell.rawType === 'construction') {
          dropped += 1
          continue
        }

        const repaymentType = normalizeRepaymentType(rateCell.rawType)
        const securityPurpose = normalizeSecurityPurpose(rateCell.purpose)
        const rateStructure = normalizeRateStructure(`${title} ${lvrOrTermLabel}`)
        const lvrTier = normalizeLvrTier(lvrOrTermLabel).tier
        const productName = normalizeProductName(title)
        const productId = `great_southern-html-${slugify(productName)}`
        const rowKey = [productId, securityPurpose, repaymentType, lvrTier, rateStructure].join('|')
        if (seen.has(rowKey)) continue
        seen.add(rowKey)

        const comparisonRate = parseComparisonRate(comparisonMap.get(`${rateCell.purpose}|${rateCell.rawType}`) ?? null)
        const confidenceScore = comparisonRate == null ? 0.955 : 0.975
        rows.push({
          bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
          collectionDate: input.collectionDate,
          productId,
          productName,
          securityPurpose,
          repaymentType,
          rateStructure,
          lvrTier,
          featureSet: normalizeFeatureSet(productName, null),
          interestRate: rateCell.interestRate,
          comparisonRate,
          annualFee: null,
          sourceUrl: input.sourceUrl,
          productUrl: productUrlForTitle(productName, input.sourceUrl),
          publishedAt: null,
          dataQualityFlag: input.qualityFlag,
          confidenceScore,
          retrievalType: 'present_scrape_same_date',
        })
      }
    }
  }

  return {
    rows,
    inspected,
    dropped,
  }
}
