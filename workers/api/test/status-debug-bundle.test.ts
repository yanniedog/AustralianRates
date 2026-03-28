import { describe, expect, it } from 'vitest'
import { parseStatusDebugSections } from '../src/pipeline/status-debug-bundle'
import { mergeRemediationHints, remediationFromActionableCodes } from '../src/pipeline/status-debug-remediation'

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
})
