import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildIntegrityRunbookSpecs,
  includesLimit20,
  isReadOnlySql,
  startsWithSelectOrWith,
  toWranglerCommand,
  validateRunbookSpecs,
} from '../../../tools/node-scripts/src/integrity/runbook'
import {
  hasRemoteFlag,
  looksLikeD1BindingName,
  parseRepairPreviewConfig,
} from '../../../tools/node-scripts/src/integrity/repair-preview'

describe('integrity runbook SQL generation', () => {
  it('produces read-only SELECT/WITH queries and LIMIT 20 sample queries', () => {
    const specs = buildIntegrityRunbookSpecs()
    expect(specs.length).toBeGreaterThan(0)
    expect(validateRunbookSpecs(specs)).toEqual([])

    for (const spec of specs) {
      expect(startsWithSelectOrWith(spec.sql)).toBe(true)
      expect(isReadOnlySql(spec.sql)).toBe(true)
      if (spec.sample) {
        expect(includesLimit20(spec.sql)).toBe(true)
      }
    }
  })

  it('produces paste-ready wrangler commands with remote flag', () => {
    const specs = buildIntegrityRunbookSpecs()
    for (const spec of specs) {
      const cmd = toWranglerCommand(spec)
      expect(cmd).toContain('wrangler d1 execute')
      expect(cmd).toContain('--remote')
      expect(cmd).toContain('--command')
      if (spec.db === 'api') {
        expect(cmd).toContain('australianrates_api')
      } else {
        expect(cmd).toContain('australianrates-archive-prod')
      }
    }
  })
})

describe('repair preview remote guard', () => {
  it('detects remote flag arguments', () => {
    expect(hasRemoteFlag(['--remote'])).toBe(true)
    expect(hasRemoteFlag(['--remote=true'])).toBe(true)
    expect(hasRemoteFlag(['--apply'])).toBe(false)
  })

  it('detects D1-style binding names', () => {
    expect(looksLikeD1BindingName('australianrates_api')).toBe(true)
    expect(looksLikeD1BindingName('australianrates-archive-prod')).toBe(true)
    expect(looksLikeD1BindingName('C:\\tmp\\clone.sqlite')).toBe(false)
    expect(looksLikeD1BindingName('./tmp/clone.db')).toBe(false)
  })

  it('refuses parse when remote flag is provided', () => {
    expect(() => parseRepairPreviewConfig(['--remote', './local.sqlite'])).toThrow(/--remote is not allowed/i)
  })

  it('accepts local sqlite file path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-preview-test-'))
    const dbPath = path.join(dir, 'clone.sqlite')
    fs.writeFileSync(dbPath, '')

    const parsed = parseRepairPreviewConfig([dbPath])
    expect(parsed.dbPath).toBe(path.resolve(dbPath))
    expect(parsed.apply).toBe(false)
  })
})
