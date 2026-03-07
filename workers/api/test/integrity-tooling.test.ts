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
import {
  buildRawLinkagePreviewSql,
  buildRawLinkageMarkdownSummary,
  parseRawLinkagePreviewConfig,
  runRawLinkageRepairPreview,
} from '../../../tools/node-scripts/src/integrity/repair-raw-linkage'
import {
  parseRawLinkageReportConfig,
  runRawLinkageReport,
  runRawLinkageReportCli,
} from '../../../tools/node-scripts/src/integrity/repair-raw-linkage-report'
import { DatabaseSync } from 'node:sqlite'
import {
  buildRepairPresenceProdApplySql,
  buildRepairPresenceProdPlanSql,
  executeRemoteSqlWithFallbackForTest,
  isSafePlanSql,
  isSafePresenceMutationSql,
  parseFirstRowFromWranglerJson,
  parseRepairPresenceProdConfig,
  runWranglerD1Execute,
  runPlanModeCli,
  runPlanOnlyForTest,
  runD1SqlFile,
  type SpawnRunner,
} from '../../../tools/node-scripts/src/integrity/repair-presence-prod'
import {
  buildRawLinkageProdPlanSql,
  parseRawLinkagePlanProdConfig,
  runRawLinkageProdPlan,
  runRawLinkageProdPlanCli,
} from '../../../tools/node-scripts/src/integrity/plan-raw-linkage-prod'
import {
  buildRawLinkageProdRepairApplySql,
  buildRawLinkageProdRepairPlanSql,
  isSafeRawLinkageInsertSql,
  parseRepairRawLinkageProdConfig,
  runRawLinkageProdRepair,
  runRawLinkageProdRepairCli,
} from '../../../tools/node-scripts/src/integrity/repair-raw-linkage-prod'

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
        '--apply',
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

  it('plan mode does not require dangerous mutation flag', () => {
    const backup = makeBackupArtifact()
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

  it('parses Windows-style backup path and runs plan mode SQL without positional args', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-presence-prod-windows-'))
    const backupPath = path.join(dir, 'api-prod-20260303T003407Z.sql')
    fs.writeFileSync(backupPath, '-- backup artifact')
    const windowsPath = backupPath.replaceAll('/', '\\')
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      windowsPath,
    ]

    const spawnCalls: Array<{ command: string; args: string[] }> = []
    let callIndex = 0
    const fakeSpawn = ((command: string, spawnArgs: string[]) => {
      spawnCalls.push({ command, args: spawnArgs })
      callIndex += 1

      const jsonRows =
        callIndex === 1
          ? [{ orphan_presence_count: 138 }]
          : [{
              missing_rows: 0,
              extra_safe_delete_rows: 0,
              extra_rows: 138,
              expected_rows: 204,
              existing_rows: 342,
            }]

      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ results: jsonRows, success: true, meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as Parameters<typeof runPlanOnlyForTest>[1]

    const parsed = parseRepairPresenceProdConfig(args)
    expect(parsed.apply).toBe(false)
    expect(parsed.backupArtifact).toBe(path.resolve(backupPath))

    const report = runPlanOnlyForTest(args, fakeSpawn)
    expect(report.orphan_before).toBe(138)
    expect(report.missing_count).toBe(0)
    expect(report.extra_safe_delete_count).toBe(0)

    expect(spawnCalls.length).toBeGreaterThan(0)
    const invocation = spawnCalls[0]?.args.join(' ') || ''
    expect(invocation).toContain('d1 execute australianrates_api --remote')
    expect(invocation).toContain('--file')
    expect(invocation).toContain('--json')
  })

  it('plan mode success prints one JSON line with required fields', () => {
    const backup = makeBackupArtifact()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ]

    const output: string[] = []
    let callIndex = 0
    const fakeSpawn = ((_: string, __: string[]) => {
      callIndex += 1
      const jsonRows =
        callIndex === 1
          ? [{ orphan_presence_count: 12 }]
          : [{
              missing_rows: 1,
              extra_safe_delete_rows: 2,
              extra_rows: 2,
              expected_rows: 10,
              existing_rows: 12,
            }]
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ results: jsonRows, success: true, meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const code = runPlanModeCli(args, {
      spawnRunner: fakeSpawn,
      stdoutWrite: (text) => output.push(text),
      argvForLog: ['node', 'scripts/repair-presence-prod.js', ...args],
    })

    expect(code).toBe(0)
    expect(output).toHaveLength(1)
    const lines = output[0]?.trim().split(/\r?\n/).filter(Boolean) ?? []
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.phase).toBe('plan')
    expect(parsed.orphan_before).toBe(12)
    expect(parsed.missing_count).toBe(1)
    expect(parsed.extra_safe_delete_count).toBe(2)
    expect(parsed.exit_code).toBe(0)
  })

  it('plan mode banner includes db and backup artifact path', () => {
    const backup = makeBackupArtifact()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ]

    const output: string[] = []
    const logs: string[] = []
    let callIndex = 0
    const fakeSpawn = ((_: string, __: string[]) => {
      callIndex += 1
      const jsonRows =
        callIndex === 1
          ? [{ orphan_presence_count: 1 }]
          : [{
              missing_rows: 0,
              extra_safe_delete_rows: 1,
              extra_rows: 1,
              expected_rows: 10,
              existing_rows: 11,
            }]
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ results: jsonRows, success: true, meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const code = runPlanModeCli(args, {
      spawnRunner: fakeSpawn,
      stdoutWrite: (text) => output.push(text),
      argvForLog: ['node', 'scripts/repair-presence-prod.js', ...args],
      logLine: (line) => logs.push(line),
    })

    expect(code).toBe(0)
    expect(output).toHaveLength(1)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]).toContain('[repair-presence-prod] start')
    expect(logs[0]).toContain('db=australianrates_api')
    expect(logs[0]).toContain(`backup_artifact=${path.resolve(backup)}`)
    expect(logs[0]).toContain('mode=plan')
  })

  it('plan mode failure prints one JSON line with phase and exit code', () => {
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      'artifacts\\missing.sql',
    ]

    const output: string[] = []
    const code = runPlanModeCli(args, {
      stdoutWrite: (text) => output.push(text),
      argvForLog: ['node', 'scripts/repair-presence-prod.js', ...args],
    })

    expect(code).toBe(1)
    expect(output).toHaveLength(1)
    const lines = output[0]?.trim().split(/\r?\n/).filter(Boolean) ?? []
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.ok).toBe(false)
    expect(parsed.phase).toBe('plan')
    expect(parsed.exit_code).toBe(1)
    expect(String(parsed.error || '')).toMatch(/CLI preflight failed/i)
  })
})

describe('repair presence production D1 invocation', () => {
  function makeBackupArtifactLocal(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-presence-prod-invoke-'))
    const backupPath = path.join(dir, 'backup.sql')
    fs.writeFileSync(backupPath, '-- backup artifact')
    return backupPath
  }

  it('uses --file execution, writes SQL text, and attempts cleanup in finally', () => {
    const spawnCalls: Array<{ command: string; args: string[] }> = []
    const writes: Array<{ filePath: string; content: string }> = []
    const unlinks: string[] = []

    const fakeSpawn = ((command: string, args: string[]) => {
      spawnCalls.push({ command, args })
      return {
        pid: 1,
        output: [],
        stdout: '[{\"results\":[{\"ok\":1}],\"success\":true,\"meta\":{\"changes\":0}}]',
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const result = runD1SqlFile('australianrates_api', true, 'SELECT 1 AS ok', 'plan-test', {
      nowMs: () => 1700000000000,
      tempDir: path.join(os.tmpdir(), 'repair-presence-prod-tests'),
      writeFile: (filePath, content) => {
        writes.push({ filePath, content })
      },
      unlinkFile: (filePath) => {
        unlinks.push(filePath)
      },
      spawnRunner: fakeSpawn,
    })

    expect(result.exitCode).toBe(0)
    expect(spawnCalls[0]?.args).toContain('--file')
    expect(spawnCalls[0]?.args).not.toContain('--command')
    expect(writes.length).toBe(1)
    expect(writes[0]?.content.trimStart().startsWith('SELECT')).toBe(true)
    expect(unlinks).toContain(writes[0]?.filePath as string)
  })

  it('on Windows chooses npx.cmd first with args-array boundaries and no split SQL tokens', () => {
    const spawnCalls: Array<{ command: string; args: string[] }> = []
    const fakeSpawn = ((command: string, args: string[]) => {
      spawnCalls.push({ command, args })
      return {
        pid: 1,
        output: [],
        stdout: '[{"results":[{"ok":1}],"success":true,"meta":{"changes":0}}]',
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const result = runD1SqlFile('australianrates_api', true, 'SELECT 1 AS ok', 'win-npx-cmd', {
      nowMs: () => 1700000004321,
      tempDir: path.join(os.tmpdir(), 'repair-presence-prod-tests'),
      writeFile: () => undefined,
      unlinkFile: () => undefined,
      spawnRunner: fakeSpawn,
      platform: 'win32',
    })

    expect(result.exitCode).toBe(0)
    const first = spawnCalls[0]
    expect(first?.command).toBe('npx.cmd')
    expect(first?.args).toEqual(expect.arrayContaining([
      'wrangler',
      'd1',
      'execute',
      'australianrates_api',
      '--remote',
      '--file',
      '--json',
    ]))
    expect(first?.args).not.toContain('--command')
    expect(first?.args).not.toContain('COUNT(*)')
    expect(first?.args).not.toContain('AS')
  })

  it('retries summary-only plan output using --command with SQL as a single argument', () => {
    const backup = makeBackupArtifactLocal()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ]

    const spawnCalls: Array<{ command: string; args: string[] }> = []
    let callIndex = 0
    const fakeSpawn = ((command: string, spawnArgs: string[]) => {
      spawnCalls.push({ command, args: spawnArgs })
      callIndex += 1

      if (callIndex === 1) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([
            {
              results: [{ 'Total queries executed': 1, 'Rows read': 10, 'Rows written': 0 }],
              success: true,
              meta: { changes: 0 },
            },
          ]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      if (callIndex === 2) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([{ results: [{ orphan_presence_count: 138 }], success: true, meta: { changes: 0 } }]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([
          {
            results: [{ missing_rows: 0, extra_safe_delete_rows: 0, extra_rows: 138, expected_rows: 204, existing_rows: 342 }],
            success: true,
            meta: { changes: 0 },
          },
        ]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const report = runPlanOnlyForTest(args, fakeSpawn)
    expect(report.orphan_before).toBe(138)
    expect(report.retry).toMatchObject({
      reason: 'summary_only_output',
      first_mode: '--file',
      retry_mode: '--command',
      used_json: true,
    })

    const commandCall = spawnCalls.find((call) => call.args.includes('--command'))
    expect(commandCall).toBeDefined()
    const commandFlagIndex = commandCall?.args.indexOf('--command') ?? -1
    expect(commandFlagIndex).toBeGreaterThan(-1)
    const sqlArg = commandCall?.args[commandFlagIndex + 1] || ''
    expect(sqlArg).toContain('SELECT COUNT(*) AS orphan_presence_count')
    expect(commandCall?.args).not.toContain('COUNT(*)')
    expect(commandCall?.args).not.toContain('AS')
  })

  it('retries without --json once when wrangler does not support --json', () => {
    const spawnCalls: Array<{ command: string; args: string[] }> = []
    const fakeSpawn = ((command: string, args: string[]) => {
      spawnCalls.push({ command, args })
      if (args.includes('--json')) {
        return {
          pid: 0,
          output: [],
          stdout: '',
          stderr: 'Unexpected argument: --json',
          status: 1,
          signal: null,
        }
      }

      return {
        pid: 1,
        output: [],
        stdout: '[{"results":[{"orphan_presence_count":138}],"success":true,"meta":{"changes":0}}]',
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const result = runD1SqlFile('australianrates_api', true, 'SELECT COUNT(*) AS orphan_presence_count', 'json-fallback', {
      nowMs: () => 1700000001234,
      tempDir: path.join(os.tmpdir(), 'repair-presence-prod-tests'),
      writeFile: () => undefined,
      unlinkFile: () => undefined,
      spawnRunner: fakeSpawn,
    })

    expect(result.exitCode).toBe(0)
    const withJsonCall = spawnCalls.find((call) => call.args.includes('--json'))
    const withoutJsonCall = spawnCalls.find((call) => !call.args.includes('--json') && call.args.includes('--file'))
    expect(withJsonCall).toBeDefined()
    expect(withoutJsonCall).toBeDefined()
    expect(withoutJsonCall?.args).not.toContain('--json')
  })

  it('plan mode never uses --command in any wrangler invocation', () => {
    const backup = makeBackupArtifactLocal()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ]

    const spawnCalls: Array<{ command: string; args: string[] }> = []
    let callIndex = 0
    const fakeSpawn = ((command: string, spawnArgs: string[]) => {
      spawnCalls.push({ command, args: spawnArgs })
      callIndex += 1
      const rows =
        callIndex === 1
          ? [{ orphan_presence_count: 5 }]
          : [{ missing_rows: 0, extra_safe_delete_rows: 0, extra_rows: 5, expected_rows: 10, existing_rows: 15 }]
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ results: rows, success: true, meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as Parameters<typeof runPlanOnlyForTest>[1]

    const report = runPlanOnlyForTest(args, fakeSpawn)
    expect(report.orphan_before).toBe(5)
    expect(spawnCalls.length).toBeGreaterThan(0)
    for (const call of spawnCalls) {
      expect(call.args).not.toContain('--command')
      expect(call.args).toContain('--file')
    }
  })

  it('apply-mode refuses routing through --command even on summary-only output', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const fakeSpawn = ((command: string, args: string[]) => {
      calls.push({ command, args })
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([
          {
            results: [{ 'Total queries executed': 1, 'Rows read': 0, 'Rows written': 0 }],
            success: true,
            meta: { changes: 1 },
          },
        ]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const result = executeRemoteSqlWithFallbackForTest(
      'australianrates_api',
      'SELECT COUNT(*) AS orphan_presence_count FROM product_presence_status',
      fakeSpawn,
      { phase: 'apply', expectedAlias: 'orphan_presence_count' },
    )

    expect(result.exitCode).toBe(0)
    expect(result.retry).toBeUndefined()
    for (const call of calls) {
      expect(call.args).not.toContain('--command')
      expect(call.args).toContain('--file')
    }
  })

  it('uses WRANGLER_BIN npx wrapper with args array', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const fakeSpawn = ((command: string, args: string[]) => {
      calls.push({ command, args })
      return {
        pid: 1,
        output: [],
        stdout: '[{"results":[{"ok":1}],"success":true}]',
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as Parameters<typeof runWranglerD1Execute>[0]['spawnRunner']

    const run = runWranglerD1Execute({
      dbName: 'australianrates_api',
      remote: true,
      json: true,
      filePath: 'C:\\temp\\query.sql',
      wranglerBin: 'npx',
      spawnRunner: fakeSpawn,
      platform: 'win32',
    })

    expect(run.exitCode).toBe(0)
    expect(calls[0]?.command).toBe('npx')
    expect(calls[0]?.args.slice(0, 4)).toEqual(['wrangler', 'd1', 'execute', 'australianrates_api'])
  })
})

describe('repair presence wrangler JSON parser', () => {
  it('parses object result shape', () => {
    const row = parseFirstRowFromWranglerJson(
      JSON.stringify({
        success: true,
        result: [{ orphan_presence_count: 138 }],
      }),
    )
    expect(row.orphan_presence_count).toBe(138)
  })

  it('parses object results shape', () => {
    const row = parseFirstRowFromWranglerJson(
      JSON.stringify({
        success: true,
        results: [{ orphan_presence_count: 138 }],
      }),
    )
    expect(row.orphan_presence_count).toBe(138)
  })

  it('parses object with meta + result shape', () => {
    const row = parseFirstRowFromWranglerJson(
      JSON.stringify({
        success: true,
        meta: { changes: 0 },
        result: [{ orphan_presence_count: 138 }],
      }),
    )
    expect(row.orphan_presence_count).toBe(138)
  })

  it('parses array-of-arrays single row/single column shape', () => {
    const row = parseFirstRowFromWranglerJson(
      JSON.stringify({
        success: true,
        results: [[138]],
      }),
    )
    expect(row.orphan_presence_count).toBe(138)
  })

  it('skips execution summary rows and returns first actual row set', () => {
    const row = parseFirstRowFromWranglerJson(
      JSON.stringify([
        {
          results: [
            {
              'Total queries executed': 1,
              'Rows read': 0,
              'Rows written': 0,
            },
          ],
          success: true,
        },
        {
          results: [{ orphan_presence_count: 138 }],
          success: true,
        },
      ]),
    )
    expect(row.orphan_presence_count).toBe(138)
  })
})

describe('repair presence production SQL safety', () => {
  it('orphan query matches canonical product_presence_status -> product_catalog definition', () => {
    const planSql = buildRepairPresenceProdPlanSql()
    const orphanSql = planSql.current_orphan_count
    expect(orphanSql).toContain('AS orphan_presence_count')
    expect(orphanSql).toContain('FROM product_presence_status pps')
    expect(orphanSql).toContain('LEFT JOIN product_catalog pc')
    expect(orphanSql).toContain('pc.dataset_kind = pps.section')
    expect(orphanSql).toContain('pc.bank_name = pps.bank_name')
    expect(orphanSql).toContain('pc.product_id = pps.product_id')
    expect(orphanSql).toContain('WHERE pc.product_id IS NULL')
  })

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

function createRawLinkageFixtureDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-raw-linkage-local-'))
  const dbPath = path.join(dir, 'clone.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
CREATE TABLE raw_payloads (
  id INTEGER PRIMARY KEY,
  source_type TEXT,
  source_url TEXT,
  content_hash TEXT,
  fetched_at TEXT
);
CREATE TABLE raw_objects (
  content_hash TEXT PRIMARY KEY,
  source_type TEXT,
  first_source_url TEXT,
  body_bytes INTEGER,
  content_type TEXT,
  r2_key TEXT,
  created_at TEXT
);
CREATE TABLE fetch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT
);
INSERT INTO raw_payloads(id, source_type, source_url, content_hash, fetched_at) VALUES
  (1, 'wayback_html', 'https://web.archive.org/web/1/http://bank.example/a', 'hash-wayback', '2026-03-03T00:00:00Z'),
  (2, 'cdr_products', 'https://api.bank.example/banking/products', 'hash-cdr', '2026-03-03T00:01:00Z'),
  (3, 'cdr_products', 'https://api.bank.example/banking/products', 'hash-cdr', '2026-03-03T00:02:00Z'),
  (4, 'rba_csv', 'https://www.rba.gov.au/statistics/file.csv', 'hash-rba', '2026-03-03T00:03:00Z');
INSERT INTO raw_objects(content_hash, source_type, first_source_url, body_bytes, content_type, r2_key, created_at) VALUES
  ('hash-linked', 'cdr_products', 'https://example.com/linked', 100, 'application/json', 'r2/k', '2026-03-03T00:01:00Z');
INSERT INTO fetch_events(content_hash) VALUES ('hash-wayback'), ('hash-cdr');
`)
  db.close()
  return dbPath
}

describe('raw linkage offline preview tooling', () => {
  it('refuses --remote and binding-like targets', () => {
    expect(() => parseRawLinkagePreviewConfig(['--remote', './clone.sqlite'])).toThrow(/--remote is not allowed/i)
    expect(() => parseRawLinkagePreviewConfig(['australianrates_api'])).toThrow(/looks like a D1 binding name/i)
    expect(() => parseRawLinkagePreviewConfig(['--remote', './clone.sqlite', '--simulate-repair'])).toThrow(
      /--remote is not allowed/i,
    )
    expect(() => parseRawLinkagePreviewConfig(['australianrates_api', '--simulate-repair'])).toThrow(
      /looks like a D1 binding name/i,
    )
  })

  it('generates read-only preview SQL', () => {
    const sql = buildRawLinkagePreviewSql()
    for (const query of Object.values(sql)) {
      expect(startsWithSelectOrWith(query)).toBe(true)
      expect(isReadOnlySql(query)).toBe(true)
    }
  })

  it('creates only repair_shadow_raw_linkage_* tables in local apply mode', () => {
    const dbPath = createRawLinkageFixtureDb()
    const db = new DatabaseSync(dbPath)

    const payloadBefore = db.prepare('SELECT COUNT(*) AS n FROM raw_payloads').get() as { n: number }
    const objectsBefore = db.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    const fetchBefore = db.prepare('SELECT COUNT(*) AS n FROM fetch_events').get() as { n: number }
    db.close()

    const dryRun = runRawLinkageRepairPreview({ dbPath, apply: false, simulateRepair: false })
    expect(dryRun.orphan_count).toBe(4)
    expect((dryRun.classification as Record<string, unknown>).missing_raw_object_row).toBe(4)
    const classification = dryRun.classification as Record<string, unknown>
    expect(Number(classification.missing_raw_object_row)).toBe(dryRun.orphan_count)
    expect(Number(classification.fetch_event_present) + Number(classification.fetch_event_missing)).toBe(dryRun.orphan_count)

    const sourceTypeBuckets = (classification.by_source_type as Array<{ bucket: string; count: number }> | undefined) || []
    const fetchBuckets = (classification.by_fetch_event_presence as Array<{ bucket: string; count: number }> | undefined) || []
    expect(sourceTypeBuckets.reduce((sum, row) => sum + row.count, 0)).toBe(dryRun.orphan_count)
    expect(fetchBuckets.reduce((sum, row) => sum + row.count, 0)).toBe(dryRun.orphan_count)

    const applyRun = runRawLinkageRepairPreview({ dbPath, apply: true, simulateRepair: false })
    expect(applyRun.ok).toBe(true)
    expect(applyRun.mode).toBe('apply_local_shadow')

    const verify = new DatabaseSync(dbPath, { readOnly: true })
    const payloadAfter = verify.prepare('SELECT COUNT(*) AS n FROM raw_payloads').get() as { n: number }
    const objectsAfter = verify.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    const fetchAfter = verify.prepare('SELECT COUNT(*) AS n FROM fetch_events').get() as { n: number }
    const shadowTables = verify
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'repair_shadow_raw_linkage_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
    verify.close()

    expect(payloadAfter.n).toBe(payloadBefore.n)
    expect(objectsAfter.n).toBe(objectsBefore.n)
    expect(fetchAfter.n).toBe(fetchBefore.n)
    expect(shadowTables.map((row) => row.name)).toEqual([
      'repair_shadow_raw_linkage_candidate_hashes',
      'repair_shadow_raw_linkage_enriched',
      'repair_shadow_raw_linkage_orphan_hashes',
      'repair_shadow_raw_linkage_orphans',
    ])
  })

  it('simulate-repair creates planned-action shadow tables only and keeps base tables unchanged', () => {
    const dbPath = createRawLinkageFixtureDb()
    const before = new DatabaseSync(dbPath)
    const payloadBefore = before.prepare('SELECT COUNT(*) AS n FROM raw_payloads').get() as { n: number }
    const objectsBefore = before.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    before.close()

    const parsed = parseRawLinkagePreviewConfig([dbPath, '--simulate-repair'])
    expect(parsed.simulateRepair).toBe(true)
    expect(parsed.apply).toBe(false)

    const report = runRawLinkageRepairPreview({ dbPath, apply: false, simulateRepair: true })
    expect(report.mode).toBe('simulate_repair_shadow')
    expect(report.orphan_count_before).toBe(report.orphan_count)
    expect(report.planned_actions_by_type.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_hashes_count)
    expect(report.planned_actions_by_bucket.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_hashes_count)

    const verify = new DatabaseSync(dbPath, { readOnly: true })
    const payloadAfter = verify.prepare('SELECT COUNT(*) AS n FROM raw_payloads').get() as { n: number }
    const objectsAfter = verify.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    const shadowTables = verify
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'repair_shadow_raw_linkage_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
    verify.close()

    expect(payloadAfter.n).toBe(payloadBefore.n)
    expect(objectsAfter.n).toBe(objectsBefore.n)
    expect(shadowTables.map((row) => row.name)).toEqual([
      'repair_shadow_raw_linkage_candidate_hashes',
      'repair_shadow_raw_linkage_enriched',
      'repair_shadow_raw_linkage_orphan_hashes',
      'repair_shadow_raw_linkage_orphans',
      'repair_shadow_raw_linkage_planned_actions',
      'repair_shadow_raw_linkage_planned_actions_by_bucket',
      'repair_shadow_raw_linkage_planned_actions_by_type',
    ])
  })

  it('simulate-repair deterministic hashes stay stable across repeated runs', () => {
    const dbPath = createRawLinkageFixtureDb()

    const first = runRawLinkageRepairPreview({ dbPath, apply: false, simulateRepair: true })
    const second = runRawLinkageRepairPreview({ dbPath, apply: false, simulateRepair: true })

    expect(first.deterministic_hashes.planned_actions_sha256).toBe(second.deterministic_hashes.planned_actions_sha256)
    expect(first.deterministic_hashes.planned_actions_by_type_sha256).toBe(
      second.deterministic_hashes.planned_actions_by_type_sha256,
    )
    expect(first.deterministic_hashes.planned_actions_by_bucket_sha256).toBe(
      second.deterministic_hashes.planned_actions_by_bucket_sha256,
    )
  })

  it('classification bucket counts are non-negative and internally consistent', () => {
    const dbPath = createRawLinkageFixtureDb()
    const report = runRawLinkageRepairPreview({ dbPath, apply: false, simulateRepair: true })
    const classification = report.classification

    expect(classification.missing_raw_object_row).toBeGreaterThanOrEqual(0)
    expect(classification.fetch_event_present).toBeGreaterThanOrEqual(0)
    expect(classification.fetch_event_missing).toBeGreaterThanOrEqual(0)
    expect(classification.legacy_wayback_html).toBeGreaterThanOrEqual(0)
    expect(classification.other_source).toBeGreaterThanOrEqual(0)
    expect(classification.missing_raw_object_row).toBe(report.orphan_count)
    expect(classification.fetch_event_present + classification.fetch_event_missing).toBe(report.orphan_count)
    expect(classification.by_source_type.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_count)
    expect(classification.by_fetch_event_presence.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_count)
    expect(classification.by_source_url_pattern.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_count)
    expect(classification.by_likely_cause.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_count)
    expect(report.planned_actions_by_type.every((row) => row.count >= 0)).toBe(true)
    expect(report.planned_actions_by_bucket.every((row) => row.count >= 0)).toBe(true)
    expect(report.planned_actions_by_type.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_hashes_count)
    expect(report.planned_actions_by_bucket.reduce((sum, row) => sum + row.count, 0)).toBe(report.orphan_hashes_count)
  })
})

describe('raw linkage offline report tooling', () => {
  it('refuses --remote and binding-like targets', () => {
    expect(() => parseRawLinkageReportConfig(['--remote', './clone.sqlite'])).toThrow(/--remote is not allowed/i)
    expect(() => parseRawLinkageReportConfig(['australianrates_api'])).toThrow(/looks like a D1 binding name/i)
  })

  it('produces deterministic hashes for the same local DB input', () => {
    const dbPath = createRawLinkageFixtureDb()
    const firstPath = path.join(path.dirname(dbPath), 'first-summary.md')
    const secondPath = path.join(path.dirname(dbPath), 'second-summary.md')

    const first = runRawLinkageReport({
      dbPath,
      apply: false,
      simulateRepair: false,
      markdownOutPath: firstPath,
    })
    const second = runRawLinkageReport({
      dbPath,
      apply: false,
      simulateRepair: false,
      markdownOutPath: secondPath,
    })

    expect((first.deterministic_hashes as Record<string, unknown>).orphan_hashes_sha256).toBe(
      (second.deterministic_hashes as Record<string, unknown>).orphan_hashes_sha256,
    )
    expect((first.deterministic_hashes as Record<string, unknown>).sample_orphans_sha256).toBe(
      (second.deterministic_hashes as Record<string, unknown>).sample_orphans_sha256,
    )
    expect((first.deterministic_hashes as Record<string, unknown>).likely_cause_buckets_sha256).toBe(
      (second.deterministic_hashes as Record<string, unknown>).likely_cause_buckets_sha256,
    )
  })

  it('emits one JSON line and writes markdown summary in cli mode', () => {
    const dbPath = createRawLinkageFixtureDb()
    const markdownOut = path.join(path.dirname(dbPath), 'summary.md')
    const args = [dbPath, '--markdown-out', markdownOut]
    const output: string[] = []

    const code = runRawLinkageReportCli(args, {
      stdoutWrite: (text) => output.push(text),
    })

    expect(code).toBe(0)
    expect(output).toHaveLength(1)
    const lines = output[0]?.trim().split(/\r?\n/).filter(Boolean) ?? []
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.phase).toBe('offline_report')
    expect(parsed.exit_code).toBe(0)
    expect(fs.existsSync(markdownOut)).toBe(true)
    const markdown = fs.readFileSync(markdownOut, 'utf8')
    expect(markdown).toContain('# Raw Linkage Preview Summary')
  })

  it('applies shadow-table-only changes when --apply is set', () => {
    const dbPath = createRawLinkageFixtureDb()
    const markdownOut = path.join(path.dirname(dbPath), 'apply-summary.md')

    const before = new DatabaseSync(dbPath)
    const payloadBefore = before.prepare('SELECT COUNT(*) AS n FROM raw_payloads').get() as { n: number }
    const objectsBefore = before.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    before.close()

    const report = runRawLinkageReport({
      dbPath,
      apply: true,
      simulateRepair: false,
      markdownOutPath: markdownOut,
    })
    expect(report.ok).toBe(true)

    const verify = new DatabaseSync(dbPath, { readOnly: true })
    const payloadAfter = verify.prepare('SELECT COUNT(*) AS n FROM raw_payloads').get() as { n: number }
    const objectsAfter = verify.prepare('SELECT COUNT(*) AS n FROM raw_objects').get() as { n: number }
    const shadowTables = verify
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'repair_shadow_raw_linkage_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
    verify.close()

    expect(payloadAfter.n).toBe(payloadBefore.n)
    expect(objectsAfter.n).toBe(objectsBefore.n)
    expect(shadowTables.map((row) => row.name)).toEqual([
      'repair_shadow_raw_linkage_candidate_hashes',
      'repair_shadow_raw_linkage_enriched',
      'repair_shadow_raw_linkage_orphan_hashes',
      'repair_shadow_raw_linkage_orphans',
    ])
  })

  it('markdown summary helper returns deterministic content for same report', () => {
    const dbPath = createRawLinkageFixtureDb()
    const report = runRawLinkageRepairPreview({ dbPath, apply: false, simulateRepair: false })
    const first = buildRawLinkageMarkdownSummary(report)
    const second = buildRawLinkageMarkdownSummary(report)
    expect(first).toBe(second)
  })
})

describe('raw linkage production plan-only tooling', () => {
  function makeBackupArtifactForRawLinkage(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-raw-linkage-prod-test-'))
    const backupPath = path.join(dir, 'backup.sql')
    fs.writeFileSync(backupPath, '-- backup artifact')
    return backupPath
  }

  it('refuses mutation flags in plan-only mode', () => {
    const backup = makeBackupArtifactForRawLinkage()
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
  })

  it('accepts Windows-style backup path separators in plan-only config', () => {
    const backup = makeBackupArtifactForRawLinkage()
    const windowsPath = backup.replaceAll('/', '\\')
    const parsed = parseRawLinkagePlanProdConfig([
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      windowsPath,
    ])

    expect(parsed.backupArtifact).toBe(path.resolve(backup))
  })

  it('builds read-only production plan SQL', () => {
    const sql = buildRawLinkageProdPlanSql()
    for (const query of Object.values(sql)) {
      expect(startsWithSelectOrWith(query)).toBe(true)
      expect(isReadOnlySql(query)).toBe(true)
    }
  })

  it('emits one JSON line with required fields in plan mode', () => {
    const backup = makeBackupArtifactForRawLinkage()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
      '--repeat',
      '1',
    ]

    let callIndex = 0
    const fakeSpawn = ((_: string, __: string[]) => {
      callIndex += 1
      const rowsByCall: Record<number, Array<Record<string, unknown>>> = {
        1: [{ orphan_count: 11 }],
        2: [{ distinct_orphan_hashes: 6 }],
        3: [{ source_type: 'wayback_html', orphan_count: 5 }],
        4: [{ id: 999, source_type: 'wayback_html', source_url: 'https://example.test', content_hash: 'h1' }],
      }
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ success: true, results: rowsByCall[callIndex] || [], meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const output: string[] = []
    const code = runRawLinkageProdPlanCli(args, {
      spawnRunner: fakeSpawn,
      stdoutWrite: (text) => output.push(text),
      argvForLog: ['node', 'scripts/plan-raw-linkage-prod.js', ...args],
    })

    expect(code).toBe(0)
    expect(output).toHaveLength(1)
    const lines = output[0]?.trim().split(/\r?\n/).filter(Boolean) ?? []
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.phase).toBe('plan')
    expect(parsed.repeats).toBe(1)
    expect(parsed.stable).toBe(true)
    expect(parsed.counts.orphan_count).toBe(11)
    expect(parsed.counts.distinct_orphan_hashes).toBe(6)
    expect(parsed.counts_per_run).toEqual([{ orphan_count: 11, distinct_orphan_hashes: 6 }])
    expect(Array.isArray(parsed.executed_commands)).toBe(true)
    expect(parsed.executed_commands).toHaveLength(4)
    expect(parsed.exit_code).toBe(0)
  })

  it('handles summary-only file output by retrying via --command in plan mode', () => {
    const backup = makeBackupArtifactForRawLinkage()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
      '--repeat',
      '1',
    ]

    const calls: Array<{ command: string; args: string[] }> = []
    let callIndex = 0
    const fakeSpawn = ((command: string, spawnArgs: string[]) => {
      calls.push({ command, args: spawnArgs })
      callIndex += 1

      if (callIndex === 1) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([
            { success: true, results: [{ 'Total queries executed': 1, 'Rows read': 3, 'Rows written': 0 }], meta: { changes: 0 } },
          ]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      if (callIndex === 2) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([{ success: true, results: [{ orphan_count: 9 }], meta: { changes: 0 } }]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      if (callIndex === 3) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([{ success: true, results: [{ distinct_orphan_hashes: 4 }], meta: { changes: 0 } }]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      if (callIndex === 4) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([{ success: true, results: [{ source_type: 'wayback_html', orphan_count: 4 }], meta: { changes: 0 } }]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ success: true, results: [{ id: 1, source_type: 'wayback_html', source_url: 'https://x', content_hash: 'h1' }], meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const report = runRawLinkageProdPlan(args, fakeSpawn)
    expect(report.ok).toBe(true)
    expect((report.counts as Record<string, unknown>).orphan_count).toBe(9)
    expect(Array.isArray(report.retry)).toBe(true)

    const retriedCommand = calls.find((call) => call.args.includes('--command'))
    expect(retriedCommand).toBeDefined()
    expect(retriedCommand?.args).toContain('--command')
  })

  it('repeat mode marks plan as unstable when counts drift between runs', () => {
    const backup = makeBackupArtifactForRawLinkage()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
      '--repeat',
      '2',
    ]

    let callIndex = 0
    const fakeSpawn = ((_: string, __: string[]) => {
      callIndex += 1
      const rowsByCall: Record<number, Array<Record<string, unknown>>> = {
        1: [{ orphan_count: 11 }],
        2: [{ distinct_orphan_hashes: 6 }],
        3: [{ source_type: 'wayback_html', orphan_count: 5 }],
        4: [{ id: 99, source_type: 'wayback_html', source_url: 'https://example.test', content_hash: 'h1' }],
        5: [{ orphan_count: 12 }],
        6: [{ distinct_orphan_hashes: 6 }],
        7: [{ source_type: 'wayback_html', orphan_count: 6 }],
        8: [{ id: 100, source_type: 'wayback_html', source_url: 'https://example.test', content_hash: 'h2' }],
      }
      return {
        pid: 1,
        output: [],
        stdout: JSON.stringify([{ success: true, results: rowsByCall[callIndex] || [], meta: { changes: 0 } }]),
        stderr: '',
        status: 0,
        signal: null,
      }
    }) as SpawnRunner

    const report = runRawLinkageProdPlan(args, fakeSpawn)
    expect(report.ok).toBe(true)
    expect(report.repeats).toBe(2)
    expect(report.stable).toBe(false)
    expect(report.counts_per_run).toEqual([
      { orphan_count: 11, distinct_orphan_hashes: 6 },
      { orphan_count: 12, distinct_orphan_hashes: 6 },
    ])
    expect(Array.isArray(report.unstable_diagnostics)).toBe(true)
    expect((report.unstable_diagnostics as unknown[]).length).toBe(2)
  })
})

describe('raw linkage production repair tooling (PR10)', () => {
  function makeBackupArtifactForRawLinkageRepair(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-raw-linkage-prod-test-'))
    const backupPath = path.join(dir, 'backup.sql')
    fs.writeFileSync(backupPath, '-- backup artifact')
    return backupPath
  }

  function jsonResult(rows: Array<Record<string, unknown>>): ReturnType<SpawnRunner> {
    return {
      pid: 1,
      output: [],
      stdout: JSON.stringify([{ success: true, results: rows, meta: { changes: 0 } }]),
      stderr: '',
      status: 0,
      signal: null,
    } as ReturnType<SpawnRunner>
  }

  it('refuses required flag omissions and enforces allowlisted db', () => {
    const backup = makeBackupArtifactForRawLinkageRepair()

    expect(() => parseRepairRawLinkageProdConfig([])).toThrow(/--remote is required/i)
    expect(() =>
      parseRepairRawLinkageProdConfig([
        '--remote',
        '--db',
        'australianrates_api',
        '--confirm-backup',
      ]),
    ).toThrow(/--backup-artifact/i)
    expect(() =>
      parseRepairRawLinkageProdConfig([
        '--remote',
        '--db',
        'other_db',
        '--confirm-backup',
        '--backup-artifact',
        backup,
      ]),
    ).toThrow(/only --db australianrates_api is allowed/i)
  })

  it('apply mode requires dangerous acknowledgement flag', () => {
    const backup = makeBackupArtifactForRawLinkageRepair()
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
  })

  it('accepts Windows-style backup path separators in repair config', () => {
    const backup = makeBackupArtifactForRawLinkageRepair()
    const windowsPath = backup.replaceAll('/', '\\')
    const parsed = parseRepairRawLinkageProdConfig([
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      windowsPath,
    ])

    expect(parsed.backupArtifact).toBe(path.resolve(backup))
  })

  it('plan-only emits a single JSON line and includes required fields', () => {
    const backup = makeBackupArtifactForRawLinkageRepair()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ]
    let callIndex = 0
    const fakeSpawn = ((_: string, __: string[]) => {
      callIndex += 1
      const rowsByCall: Record<number, Array<Record<string, unknown>>> = {
        1: [{ orphan_count: 6, distinct_hashes_count: 4, insert_candidates_count: 2 }],
        2: [{ bucket: 'legacy_wayback_html', row_count: 3 }],
        3: [
          {
            content_hash: 'hash-a',
            source_type: 'cdr_products',
            first_source_url: 'https://a.example',
            r2_key: 'r2/a',
            body_bytes: 120,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
          {
            content_hash: 'hash-b',
            source_type: 'cdr_products',
            first_source_url: 'https://b.example',
            r2_key: 'r2/b',
            body_bytes: 140,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
        4: [
          {
            content_hash: 'hash-a',
            source_type: 'cdr_products',
            first_source_url: 'https://a.example',
            r2_key: 'r2/a',
            body_bytes: 120,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
      }
      return jsonResult(rowsByCall[callIndex] || [])
    }) as SpawnRunner

    const output: string[] = []
    const code = runRawLinkageProdRepairCli(args, {
      spawnRunner: fakeSpawn,
      stdoutWrite: (text) => output.push(text),
      argvForLog: ['node', 'scripts/repair-raw-linkage-prod.js', ...args],
    })

    expect(code).toBe(0)
    expect(output).toHaveLength(1)
    const lines = output[0]?.trim().split(/\r?\n/).filter(Boolean) ?? []
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.phase).toBe('plan')
    expect(parsed.mode).toBe('plan')
    expect(parsed.orphan_before).toBe(6)
    expect(parsed.distinct_hashes_count).toBe(4)
    expect(parsed.insert_candidates_count).toBe(2)
    expect(typeof parsed.plan_hash).toBe('string')
    expect(parsed.exit_code).toBe(0)
  })

  it('apply SQL validator permits INSERT-only raw_objects SQL', () => {
    const applySql = buildRawLinkageProdRepairApplySql()
    expect(isSafeRawLinkageInsertSql(applySql.insert_repairable_raw_objects)).toBe(true)
    expect(isSafeRawLinkageInsertSql('WITH x AS (SELECT 1) INSERT INTO raw_objects(content_hash,source_type,first_source_url,body_bytes,content_type,r2_key,created_at) SELECT 1,2,3,4,5,6,7')).toBe(true)
    expect(isSafeRawLinkageInsertSql('WITH x AS (SELECT 1) DELETE FROM raw_objects')).toBe(false)
    expect(isSafeRawLinkageInsertSql('WITH x AS (SELECT 1) INSERT INTO product_presence_status(section) SELECT 1')).toBe(false)
  })

  it('pre-apply hash/count precondition blocks apply if plan changed', () => {
    const backup = makeBackupArtifactForRawLinkageRepair()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
      '--i-know-this-will-mutate-production',
      '--apply',
    ]

    let callIndex = 0
    const fakeSpawn = ((_: string, __: string[]) => {
      callIndex += 1
      const rowsByCall: Record<number, Array<Record<string, unknown>>> = {
        1: [{ orphan_count: 6, distinct_hashes_count: 4, insert_candidates_count: 2 }],
        2: [{ bucket: 'legacy_wayback_html', row_count: 3 }],
        3: [
          {
            content_hash: 'hash-a',
            source_type: 'cdr_products',
            first_source_url: 'https://a.example',
            r2_key: 'r2/a',
            body_bytes: 120,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
        4: [
          {
            content_hash: 'hash-a',
            source_type: 'cdr_products',
            first_source_url: 'https://a.example',
            r2_key: 'r2/a',
            body_bytes: 120,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
        5: [{ orphan_count: 7, distinct_hashes_count: 4, insert_candidates_count: 3 }],
        6: [{ bucket: 'legacy_wayback_html', row_count: 3 }],
        7: [
          {
            content_hash: 'hash-z',
            source_type: 'cdr_products',
            first_source_url: 'https://z.example',
            r2_key: 'r2/z',
            body_bytes: 220,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
        8: [
          {
            content_hash: 'hash-z',
            source_type: 'cdr_products',
            first_source_url: 'https://z.example',
            r2_key: 'r2/z',
            body_bytes: 220,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
      }
      return jsonResult(rowsByCall[callIndex] || [])
    }) as SpawnRunner

    expect(() => runRawLinkageProdRepair(args, fakeSpawn)).toThrow(/Precondition failed: plan changed before apply/i)
  })

  it('summary-only plan output retries via --command and still succeeds', () => {
    const backup = makeBackupArtifactForRawLinkageRepair()
    const args = [
      '--remote',
      '--db',
      'australianrates_api',
      '--confirm-backup',
      '--backup-artifact',
      backup,
    ]
    const calls: Array<{ args: string[] }> = []
    let callIndex = 0
    const fakeSpawn = ((_: string, spawnArgs: string[]) => {
      calls.push({ args: spawnArgs })
      callIndex += 1
      if (callIndex === 1) {
        return {
          pid: 1,
          output: [],
          stdout: JSON.stringify([
            { success: true, results: [{ 'Total queries executed': 1, 'Rows read': 0, 'Rows written': 0 }], meta: { changes: 0 } },
          ]),
          stderr: '',
          status: 0,
          signal: null,
        }
      }

      const rowsByCall: Record<number, Array<Record<string, unknown>>> = {
        2: [{ orphan_count: 6, distinct_hashes_count: 4, insert_candidates_count: 2 }],
        3: [{ bucket: 'legacy_wayback_html', row_count: 3 }],
        4: [
          {
            content_hash: 'hash-a',
            source_type: 'cdr_products',
            first_source_url: 'https://a.example',
            r2_key: 'r2/a',
            body_bytes: 120,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
        5: [
          {
            content_hash: 'hash-a',
            source_type: 'cdr_products',
            first_source_url: 'https://a.example',
            r2_key: 'r2/a',
            body_bytes: 120,
            content_type: 'application/json',
            reason_bucket: 'likely_missing_raw_object_row',
          },
        ],
      }
      return jsonResult(rowsByCall[callIndex] || [])
    }) as SpawnRunner

    const report = runRawLinkageProdRepair(args, fakeSpawn)
    expect(report.ok).toBe(true)
    expect((report as Record<string, unknown>).phase).toBe('plan')
    const retried = calls.some((call) => call.args.includes('--command'))
    expect(retried).toBe(true)
  })

  it('plan SQL remains SELECT/WITH only', () => {
    const sql = buildRawLinkageProdRepairPlanSql()
    for (const query of Object.values(sql)) {
      expect(startsWithSelectOrWith(query)).toBe(true)
      expect(isReadOnlySql(query)).toBe(true)
    }
  })
})
