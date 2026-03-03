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
  runPresenceRepair,
} from '../../../tools/node-scripts/src/integrity/repair-presence'
import { DatabaseSync } from 'node:sqlite'
import {
  buildRepairPresenceProdApplySql,
  buildRepairPresenceProdPlanSql,
  isSafePlanSql,
  isSafePresenceMutationSql,
  parseRepairPresenceProdConfig,
} from '../../../tools/node-scripts/src/integrity/repair-presence-prod'

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

describe('repair presence tooling', () => {
  it('generates read-only SELECT/WITH preview SQL', () => {
    const sqlMap = buildRepairPresencePreviewSqls('product_catalog')
    for (const sql of Object.values(sqlMap)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isReadOnlySql(sql)).toBe(true)
    }
  })

  it('refuses parse when remote flag is provided', () => {
    expect(() => parseRepairPresenceConfig(['--remote', './clone.sqlite'])).toThrow(/--remote is not allowed/i)
  })

  it('apply mode only mutates product_presence_status and repair_shadow_* tables on a local db', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-presence-test-'))
    const dbPath = path.join(dir, 'clone.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`
CREATE TABLE product_catalog (
  dataset_kind TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  is_removed INTEGER,
  removed_at TEXT,
  last_seen_collection_date TEXT,
  last_seen_at TEXT,
  last_successful_run_id TEXT
);
CREATE TABLE product_presence_status (
  section TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  is_removed INTEGER NOT NULL,
  removed_at TEXT,
  last_seen_collection_date TEXT,
  last_seen_at TEXT NOT NULL,
  last_seen_run_id TEXT,
  PRIMARY KEY (section, bank_name, product_id)
);
CREATE TABLE historical_loan_rates (bank_name TEXT, product_id TEXT);
CREATE TABLE historical_savings_rates (bank_name TEXT, product_id TEXT);
CREATE TABLE historical_term_deposit_rates (bank_name TEXT, product_id TEXT);
INSERT INTO product_catalog (
  dataset_kind, bank_name, product_id, is_removed, removed_at,
  last_seen_collection_date, last_seen_at, last_successful_run_id
) VALUES (
  'savings', 'catalog_bank', 'catalog_product', 0, NULL,
  '2026-03-03', '2026-03-03T00:00:00Z', 'run-catalog'
);
INSERT INTO product_presence_status (
  section, bank_name, product_id, is_removed, removed_at,
  last_seen_collection_date, last_seen_at, last_seen_run_id
) VALUES (
  'savings', 'orphan_bank', 'orphan_product', 0, NULL,
  '2026-03-01', '2026-03-01T00:00:00Z', 'run-orphan'
);
`)

    const beforeCatalog = db.prepare(`SELECT COUNT(*) AS n FROM product_catalog`).get() as { n: number }
    const beforeLoan = db.prepare(`SELECT COUNT(*) AS n FROM historical_loan_rates`).get() as { n: number }
    const beforeSavings = db.prepare(`SELECT COUNT(*) AS n FROM historical_savings_rates`).get() as { n: number }
    const beforeTd = db.prepare(`SELECT COUNT(*) AS n FROM historical_term_deposit_rates`).get() as { n: number }
    db.close()

    const result = runPresenceRepair({ dbPath, apply: true, deleteSafeExtras: true })
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('apply_local')
    expect(result.before.counts.missing_rows).toBe(1)
    expect(result.before.counts.extra_rows).toBe(1)
    expect(result.after.counts.missing_rows).toBe(0)
    expect(result.after.counts.extra_rows).toBe(0)
    expect(result.apply_actions.inserted_missing_rows).toBe(1)
    expect(result.apply_actions.deleted_extra_rows).toBe(1)

    const verifyDb = new DatabaseSync(dbPath, { readOnly: true })
    const afterCatalog = verifyDb.prepare(`SELECT COUNT(*) AS n FROM product_catalog`).get() as { n: number }
    const afterLoan = verifyDb.prepare(`SELECT COUNT(*) AS n FROM historical_loan_rates`).get() as { n: number }
    const afterSavings = verifyDb.prepare(`SELECT COUNT(*) AS n FROM historical_savings_rates`).get() as { n: number }
    const afterTd = verifyDb.prepare(`SELECT COUNT(*) AS n FROM historical_term_deposit_rates`).get() as { n: number }
    const afterPresence = verifyDb.prepare(`SELECT COUNT(*) AS n FROM product_presence_status`).get() as { n: number }
    const orphanPresence = verifyDb
      .prepare(
        `SELECT COUNT(*) AS n
         FROM product_presence_status p
         LEFT JOIN product_catalog c
           ON c.dataset_kind = p.section
          AND c.bank_name = p.bank_name
          AND c.product_id = p.product_id
         WHERE c.product_id IS NULL`,
      )
      .get() as { n: number }
    const shadowTables = verifyDb
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type='table' AND name LIKE 'repair_shadow_presence_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
    verifyDb.close()

    expect(afterCatalog.n).toBe(beforeCatalog.n)
    expect(afterLoan.n).toBe(beforeLoan.n)
    expect(afterSavings.n).toBe(beforeSavings.n)
    expect(afterTd.n).toBe(beforeTd.n)
    expect(afterPresence.n).toBe(1)
    expect(orphanPresence.n).toBe(0)
    expect(shadowTables.map((row) => row.name)).toEqual([
      'repair_shadow_presence_expected',
      'repair_shadow_presence_extra',
      'repair_shadow_presence_extra_safe_delete',
      'repair_shadow_presence_missing',
    ])
  })
})

describe('repair presence production guardrails', () => {
  function makeBackupArtifact(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-presence-prod-test-'))
    const backupPath = path.join(dir, 'backup.sql')
    fs.writeFileSync(backupPath, '-- backup artifact')
    return backupPath
  }

  it('refuses when required flags are missing', () => {
    const backup = makeBackupArtifact()
    expect(() => parseRepairPresenceProdConfig([])).toThrow(/--remote is required/i)
    expect(() =>
      parseRepairPresenceProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--confirm-backup',
        '--backup-artifact',
        backup,
      ]),
    ).toThrow(/--i-know-this-will-mutate-production is required/i)
    expect(() =>
      parseRepairPresenceProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--i-know-this-will-mutate-production',
        '--backup-artifact',
        backup,
      ]),
    ).toThrow(/--confirm-backup is required/i)
    expect(() =>
      parseRepairPresenceProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--i-know-this-will-mutate-production',
        '--confirm-backup',
      ]),
    ).toThrow(/--backup-artifact/i)
    expect(() =>
      parseRepairPresenceProdConfig([
        '--remote',
        '--db',
        'other_db',
        '--i-know-this-will-mutate-production',
        '--confirm-backup',
        '--backup-artifact',
        backup,
      ]),
    ).toThrow(/only --db australianrates_api is allowed/i)
  })

  it('accepts config when all required production guard flags are present', () => {
    const backup = makeBackupArtifact()
    const parsed = parseRepairPresenceProdConfig([
      '--remote',
      '--db',
      'australianrates_api',
      '--i-know-this-will-mutate-production',
      '--confirm-backup',
      '--backup-artifact',
      backup,
      '--apply',
      '--delete-extras',
    ])

    expect(parsed.remote).toBe(true)
    expect(parsed.db).toBe('australianrates_api')
    expect(parsed.apply).toBe(true)
    expect(parsed.deleteExtras).toBe(true)
    expect(parsed.backupArtifact).toBe(path.resolve(backup))
  })
})

describe('repair presence production SQL safety', () => {
  it('plan SQL is read-only SELECT/WITH', () => {
    const planSql = buildRepairPresenceProdPlanSql()
    for (const sql of Object.values(planSql)) {
      expect(startsWithSelectOrWith(sql)).toBe(true)
      expect(isSafePlanSql(sql)).toBe(true)
    }
  })

  it('apply SQL only mutates product_presence_status via INSERT/DELETE', () => {
    const applySql = buildRepairPresenceProdApplySql()
    expect(isSafePresenceMutationSql(applySql.insert_missing)).toBe(true)
    expect(isSafePresenceMutationSql(applySql.delete_safe_extras)).toBe(true)
    expect(applySql.insert_missing).toMatch(/INSERT OR IGNORE INTO\s+product_presence_status/i)
    expect(applySql.delete_safe_extras).toMatch(/DELETE FROM\s+product_presence_status/i)
    expect(applySql.insert_missing).not.toMatch(/INSERT\s+INTO\s+(?!product_presence_status\b)[a-z_][a-z0-9_]*/i)
    expect(applySql.delete_safe_extras).not.toMatch(/DELETE\s+FROM\s+(?!product_presence_status\b)[a-z_][a-z0-9_]*/i)
  })
})
