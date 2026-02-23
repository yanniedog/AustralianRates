import type { LenderConfig } from '../types'

export type LenderPlaybook = {
  code: string
  cdrVersions: number[]
  minRatePercent: number
  maxRatePercent: number
  dailyMinConfidence: number
  historicalMinConfidence: number
  includeKeywords: string[]
  excludeKeywords: string[]
}

const COMMON_INCLUDE = ['home', 'loan', 'fixed', 'variable', 'owner', 'invest']
const COMMON_EXCLUDE = [
  'disclaimer',
  'warning',
  'tooltip',
  'cashback',
  'lvr',
  'loan to value',
  'terms and conditions',
  'privacy',
  'copyright',
  'example',
]

const PLAYBOOKS: Record<string, LenderPlaybook> = {
  cba: {
    code: 'cba',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'commbank'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  westpac: {
    code: 'westpac',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'westpac', 'rocket', 'flexi'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  nab: {
    code: 'nab',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'nab'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  anz: {
    code: 'anz',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.93,
    historicalMinConfidence: 0.85,
    includeKeywords: [...COMMON_INCLUDE, 'anz'],
    excludeKeywords: [...COMMON_EXCLUDE, 'estimated'],
  },
  macquarie: {
    code: 'macquarie',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'macquarie'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  bendigo_adelaide: {
    code: 'bendigo_adelaide',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'bendigo', 'adelaide'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  suncorp: {
    code: 'suncorp',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'suncorp'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  bankwest: {
    code: 'bankwest',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'bankwest'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  ing: {
    code: 'ing',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'ing'],
    excludeKeywords: COMMON_EXCLUDE,
  },
  amp: {
    code: 'amp',
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, 'amp'],
    excludeKeywords: COMMON_EXCLUDE,
  },
}

const DEFAULT_PLAYBOOK: LenderPlaybook = {
  code: 'default',
  cdrVersions: [3, 4, 5, 6, 2, 1],
  minRatePercent: 0.5,
  maxRatePercent: 20,
  dailyMinConfidence: 0.92,
  historicalMinConfidence: 0.84,
  includeKeywords: COMMON_INCLUDE,
  excludeKeywords: COMMON_EXCLUDE,
}

export function getLenderPlaybook(lender: Pick<LenderConfig, 'code'>): LenderPlaybook {
  return PLAYBOOKS[lender.code] || DEFAULT_PLAYBOOK
}
