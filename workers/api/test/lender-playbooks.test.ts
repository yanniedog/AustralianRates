import { describe, expect, it } from 'vitest'
import lendersConfig from '../config/lenders.json'
import { getLenderPlaybook } from '../src/ingest/lender-playbooks'

describe('lender playbooks coverage', () => {
  it('defines a strict playbook for every configured target lender', () => {
    const lenders = (lendersConfig as { lenders: Array<{ code: string }> }).lenders
    expect(lenders.length).toBeGreaterThanOrEqual(10)
    for (const lender of lenders) {
      const playbook = getLenderPlaybook({ code: lender.code } as { code: string })
      expect(playbook.code).toBe(lender.code)
      expect(playbook.cdrVersions.length).toBeGreaterThan(0)
      expect(playbook.dailyMinConfidence).toBeGreaterThanOrEqual(0.9)
      expect(playbook.historicalMinConfidence).toBeGreaterThanOrEqual(0.8)
      expect(playbook.excludeKeywords.length).toBeGreaterThan(0)
      expect(playbook.includeKeywords.length).toBeGreaterThan(0)
    }
  })
})
