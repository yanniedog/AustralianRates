import { describe, expect, it } from 'vitest'
import { detectExplicitOffsetAccountValue } from '../src/ingest/cdr/mortgage-offset'
import type { JsonRecord } from '../src/ingest/cdr/primitives'

describe('detectExplicitOffsetAccountValue', () => {
  it('ignores unrelated generic availability flags', () => {
    const detail = {
      name: 'Sample Mortgage',
      features: [{ name: 'Redraw', available: true }],
    } satisfies JsonRecord

    expect(detectExplicitOffsetAccountValue(detail)).toBeNull()
  })

  it('uses generic availability when the feature text explicitly mentions offset', () => {
    const detail = {
      name: 'Sample Mortgage',
      features: [{ name: '100% offset account', available: true }],
    } satisfies JsonRecord

    expect(detectExplicitOffsetAccountValue(detail)).toBe(true)
  })

  it('detects explicit negative offset text from feature availability', () => {
    const detail = {
      name: 'Sample Mortgage',
      features: [{ description: 'No offset account', isAvailable: false }],
    } satisfies JsonRecord

    expect(detectExplicitOffsetAccountValue(detail)).toBe(false)
  })
})
