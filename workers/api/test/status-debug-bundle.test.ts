import { describe, expect, it } from 'vitest'
import { parseStatusDebugSections } from '../src/pipeline/status-debug-bundle'
import {
  mergeRemediationHints,
  remediationFromActionableCodes,
  remediationFromIntegrityFindings,
} from '../src/pipeline/status-debug-remediation'

describe('status-debug-bundle', () => {
  it('parseStatusDebugSections defaults to full set', () => {
    const s = parseStatusDebugSections(undefined)
    expect(s.has('health')).toBe(true)
    expect(s.has('integrity_audit')).toBe(true)
    expect(s.has('remediation')).toBe(true)
  })

  it('parseStatusDebugSections parses comma list', () => {
    const s = parseStatusDebugSections('health, logs')
    expect(s.has('health')).toBe(true)
    expect(s.has('logs')).toBe(true)
    expect(s.has('cdr')).toBe(false)
  })
})

describe('status-debug-remediation', () => {
  it('mergeRemediationHints dedupes by scope_key', () => {
    const a = remediationFromActionableCodes(['cdr_audit_detected_gaps'])
    const b = remediationFromActionableCodes(['cdr_audit_detected_gaps'])
    const m = mergeRemediationHints([a, b])
    expect(m.length).toBe(1)
    expect(m[0]?.path).toBe('/cdr-audit/run')
  })

  it('adds repair-lineage remediation for failed recent lineage findings', () => {
    const hints = remediationFromIntegrityFindings([
      { check: 'recent_stored_rows_missing_fetch_event_lineage', passed: false },
    ])
    expect(hints[0]?.path).toBe('/runs/repair-lineage')
  })

  it('adds lineage diagnostics debug remediation when integrity findings include a sample run', () => {
    const hints = remediationFromIntegrityFindings([
      {
        check: 'recent_stored_rows_unresolved_fetch_event_lineage',
        passed: false,
        detail: {
          sample: [
            {
              dataset: 'savings',
              run_id: 'daily:2026-03-28:2026-03-27T18:00:06.000Z',
            },
          ],
        },
      },
    ])
    expect(hints[0]?.path).toBe('/runs/repair-lineage')
    expect(hints[1]?.path).toBe(
      '/diagnostics/lineage?dataset=savings&run_id=daily%3A2026-03-28%3A2026-03-27T18%3A00%3A06.000Z',
    )
  })

  it('adds provenance diagnostics and recovery hints for historical unverifiable rows', () => {
    const hints = remediationFromActionableCodes(['historical_provenance_legacy_unverifiable_rows'])
    expect(hints[0]?.path).toBe('/diagnostics/provenance?refresh=1')
    expect(hints[1]?.path).toBe('/runs/provenance-recovery')
  })
})
