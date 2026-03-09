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
import {
  buildRepairPresencePreviewSqls,
  parseRepairPresenceConfig,
} from '../../../tools/node-scripts/src/integrity/repair-presence'
import {
  buildRawLinkagePreviewSql,
  parseRawLinkagePreviewConfig,
} from '../../../tools/node-scripts/src/integrity/repair-raw-linkage'
import { parseRawLinkageReportConfig } from '../../../tools/node-scripts/src/integrity/repair-raw-linkage-report'
import {
  buildRepairPresenceProdApplySql,
  buildRepairPresenceProdPlanSql,
  isSafePlanSql,
  isSafePresenceMutationSql,
  parseFirstRowFromWranglerJson,
  parseRepairPresenceProdConfig,
} from '../../../tools/node-scripts/src/integrity/repair-presence-prod'
import {
  buildRawLinkageProdPlanSql,
  parseRawLinkagePlanProdConfig,
} from '../../../tools/node-scripts/src/integrity/plan-raw-linkage-prod'
import {
  buildRawLinkageProdRepairApplySql,
  buildRawLinkageProdRepairPlanSql,
  isSafeRawLinkageInsertSql,
  parseRepairRawLinkageProdConfig,
} from '../../../tools/node-scripts/src/integrity/repair-raw-linkage-prod'

function makeTempFile(prefix: string, name: string, contents = ''): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, contents)
  return filePath
}

function makeBackupArtifact(prefix: string): string {
  return makeTempFile(prefix, 'backup.sql', '-- backup artifact')
}

describe('integrity tooling pure safeguards', () => {
  it('keeps runbook SQL read-only and sample queries limited', () => {
    const specs = buildIntegrityRunbookSpecs()
    expect(specs.length).toBeGreaterThan(0)
    expect(validateRunbookSpecs(specs)).toEqual([])

    for (const spec of specs) {
      expect(startsWithSelectOrWith(spec.sql)).toBe(true)
      expect(isReadOnlySql(spec.sql)).toBe(true)
      if (spec.sample) expect(includesLimit20(spec.sql)).toBe(true)
      expect(toWranglerCommand(spec)).toContain('wrangler d1 execute')
    }
  })

  it('parses offline repair-preview arguments without allowing remote execution', () => {
    expect(hasRemoteFlag(['--remote'])).toBe(true)
    expect(hasRemoteFlag(['--apply'])).toBe(false)
    expect(looksLikeD1BindingName('australianrates_api')).toBe(true)
    expect(looksLikeD1BindingName('C:\\tmp\\clone.sqlite')).toBe(false)
    expect(() => parseRepairPreviewConfig(['--remote', './local.sqlite'])).toThrow(/--remote is not allowed/i)
    expect(() => parseRepairPresenceConfig(['--remote', './clone.sqlite'])).toThrow(/--remote is not allowed/i)

    const dbPath = makeTempFile('repair-preview-test-', 'clone.sqlite')
    expect(parseRepairPreviewConfig([dbPath]).dbPath).toBe(path.resolve(dbPath))
  })

  it('keeps local repair SQL read-only and refuses D1 binding names for raw linkage tooling', () => {
    const previewSql = buildRepairPresencePreviewSqls('product_catalog')
    for (const sql of Object.values(previewSql)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isReadOnlySql(sql)).toBe(true)
    }

    const rawSql = buildRawLinkagePreviewSql()
    for (const sql of Object.values(rawSql)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isReadOnlySql(sql)).toBe(true)
    }

    expect(() => parseRawLinkagePreviewConfig(['--remote', './clone.sqlite'])).toThrow(/--remote is not allowed/i)
    expect(() => parseRawLinkagePreviewConfig(['australianrates_api'])).toThrow(/looks like a D1 binding name/i)
    expect(() => parseRawLinkageReportConfig(['--remote', './clone.sqlite'])).toThrow(/--remote is not allowed/i)
  })
})

describe('repair presence production safeguards', () => {
  it('requires remote backup guardrails before parsing production config', () => {
    const backup = makeBackupArtifact('repair-presence-prod-test-')
    expect(() => parseRepairPresenceProdConfig([])).toThrow(/--remote is required/i)
    expect(() =>
      parseRepairPresenceProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--apply',
        '--confirm-backup',
        '--backup-artifact',
        backup,
      ]),
    ).toThrow(/--i-know-this-will-mutate-production is required/i)

    const parsed = parseRepairPresenceProdConfig([
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ])
    expect(parsed.apply).toBe(false)
    expect(parsed.acknowledgeMutation).toBe(false)
  })

  it('parses wrangler JSON result variants', () => {
    expect(
      parseFirstRowFromWranglerJson(
        JSON.stringify({
          success: true,
          result: [{ orphan_presence_count: 138 }],
        }),
      ).orphan_presence_count,
    ).toBe(138)

    expect(
      parseFirstRowFromWranglerJson(
        JSON.stringify({
          success: true,
          results: [[138]],
        }),
      ).orphan_presence_count,
    ).toBe(138)
  })

  it('keeps production presence SQL safe', () => {
    const planSql = buildRepairPresenceProdPlanSql()
    for (const sql of Object.values(planSql)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isSafePlanSql(sql)).toBe(true)
    }

    const applySql = buildRepairPresenceProdApplySql()
    expect(isSafePresenceMutationSql(applySql.insert_missing)).toBe(true)
    expect(isSafePresenceMutationSql(applySql.delete_safe_extras)).toBe(true)
    expect(applySql.insert_missing).toMatch(/INSERT OR IGNORE INTO\s+product_presence_status/i)
    expect(applySql.delete_safe_extras).toMatch(/DELETE FROM\s+product_presence_status/i)
  })

  it.todo(
    'exercise repair-presence production execution against a real D1 export fixture or remote dry-run response instead of fabricated command output',
  )
})

describe('raw linkage production safeguards', () => {
  it('keeps plan-only config strict and SQL read-only', () => {
    const backup = makeBackupArtifact('plan-raw-linkage-prod-test-')
    expect(() =>
      parseRawLinkagePlanProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--confirm-backup',
        '--backup-artifact',
        backup,
        '--apply',
      ]),
    ).toThrow(/mutation flags are forbidden/i)

    const parsed = parseRawLinkagePlanProdConfig([
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup.replaceAll('/', '\\'),
      '--repeat',
      '1',
    ])
    expect(parsed.repeat).toBe(1)

    const planSql = buildRawLinkageProdPlanSql()
    for (const sql of Object.values(planSql)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isReadOnlySql(sql)).toBe(true)
    }
  })

  it('requires production repair acknowledgements and keeps mutation SQL allowlisted', () => {
    const backup = makeBackupArtifact('repair-raw-linkage-prod-test-')
    expect(() => parseRepairRawLinkageProdConfig([])).toThrow(/--remote is required/i)
    expect(() =>
      parseRepairRawLinkageProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--confirm-backup',
        '--backup-artifact',
        backup,
        '--apply',
      ]),
    ).toThrow(/--i-know-this-will-mutate-production is required/i)

    const planSql = buildRawLinkageProdRepairPlanSql()
    for (const sql of Object.values(planSql)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isSafePlanSql(sql)).toBe(true)
    }

    const applySql = buildRawLinkageProdRepairApplySql()
    expect(isSafeRawLinkageInsertSql(applySql.insert_repairable_raw_objects)).toBe(true)
    expect(isSafeRawLinkageInsertSql('WITH x AS (SELECT 1) DELETE FROM raw_objects')).toBe(false)
  })

  it.todo(
    'exercise raw-linkage plan and repair commands against real D1 data instead of simulated CLI output',
  )
})
