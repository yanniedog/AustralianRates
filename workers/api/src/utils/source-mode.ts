export type SourceMode = 'all' | 'scheduled' | 'manual'

function asLower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function toBool(value: unknown): boolean | null {
  const v = asLower(value)
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return null
}

export function parseSourceMode(input: unknown, includeManualInput: unknown): SourceMode {
  const mode = asLower(input)
  if (mode === 'all' || mode === 'scheduled' || mode === 'manual') {
    return mode
  }

  // Backward compatibility for old clients using include_manual.
  const includeManual = toBool(includeManualInput)
  if (includeManual === true) return 'all'
  if (includeManual === false) return 'scheduled'

  // New default is "all" for completeness.
  return 'all'
}

export function runSourceWhereClause(columnName: string, sourceMode: SourceMode): string {
  if (sourceMode === 'manual') {
    return `${columnName} = 'manual'`
  }
  if (sourceMode === 'scheduled') {
    return `(${columnName} IS NULL OR ${columnName} != 'manual')`
  }
  return '1=1'
}
