import type { SourceMode } from './source-mode'

export type SourceMix = {
  scheduled: number
  manual: number
}

export type ListMeta = {
  source_mode: SourceMode
  source_mix: SourceMix
  coverage: {
    total_rows: number
    returned_rows: number
    has_data: boolean
    limited: boolean
  }
  generated_at: string
  disclosures?: {
    comparison_rate?: {
      loan_amount_aud: number
      term_years: number
      statement: string
      limitations: string[]
    }
  }
}

function safeNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function makeSourceMix(input?: Partial<SourceMix> | null): SourceMix {
  return {
    scheduled: Math.max(0, safeNumber(input?.scheduled)),
    manual: Math.max(0, safeNumber(input?.manual)),
  }
}

export function sourceMixFromRows(rows: Array<Record<string, unknown>>): SourceMix {
  let scheduled = 0
  let manual = 0
  for (const row of rows) {
    const runSource = String(row.run_source ?? 'scheduled').toLowerCase()
    if (runSource === 'manual') manual += 1
    else scheduled += 1
  }
  return { scheduled, manual }
}

export function buildListMeta(input: {
  sourceMode: SourceMode
  totalRows: number
  returnedRows: number
  sourceMix?: Partial<SourceMix> | null
  limited?: boolean
  disclosures?: ListMeta['disclosures']
}): ListMeta {
  const meta: ListMeta = {
    source_mode: input.sourceMode,
    source_mix: makeSourceMix(input.sourceMix),
    coverage: {
      total_rows: Math.max(0, safeNumber(input.totalRows)),
      returned_rows: Math.max(0, safeNumber(input.returnedRows)),
      has_data: safeNumber(input.totalRows) > 0,
      limited: Boolean(input.limited),
    },
    generated_at: new Date().toISOString(),
  }

  if (input.disclosures && input.disclosures.comparison_rate) {
    meta.disclosures = {
      comparison_rate: {
        loan_amount_aud: Math.max(0, safeNumber(input.disclosures.comparison_rate.loan_amount_aud)),
        term_years: Math.max(0, safeNumber(input.disclosures.comparison_rate.term_years)),
        statement: String(input.disclosures.comparison_rate.statement || ''),
        limitations: Array.isArray(input.disclosures.comparison_rate.limitations)
          ? input.disclosures.comparison_rate.limitations.map((v) => String(v))
          : [],
      },
    }
  }

  return meta
}

export function setCsvMetaHeaders(
  c: { header: (name: string, value: string) => void },
  meta: ListMeta,
): void {
  c.header('X-AR-Source-Mode', meta.source_mode)
  c.header(
    'X-AR-Source-Mix',
    JSON.stringify(meta.source_mix),
  )
  c.header(
    'X-AR-Coverage',
    JSON.stringify(meta.coverage),
  )
  c.header('X-AR-Generated-At', meta.generated_at)

  const comparisonRate = meta.disclosures?.comparison_rate
  if (comparisonRate) {
    c.header(
      'X-AR-Comparison-Rate-Basis',
      `$${comparisonRate.loan_amount_aud} over ${comparisonRate.term_years} years`,
    )
    c.header('X-AR-Comparison-Rate-Statement', comparisonRate.statement)
    c.header('X-AR-Comparison-Rate-Limitations', JSON.stringify(comparisonRate.limitations))
  }
}
