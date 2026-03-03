import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { hasRemoteFlag, looksLikeD1BindingName } from './repair-preview'
import {
  buildRawLinkageMarkdownSummary,
  runRawLinkageRepairPreview,
  type RawLinkagePreviewConfig,
  type RawLinkagePreviewReport,
} from './repair-raw-linkage'

type RawLinkageReportConfig = RawLinkagePreviewConfig & {
  markdownOutPath: string
}

function resolveExistingLocalDbPath(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error(
      'Usage: repair-raw-linkage-report.ts <local-sqlite-db-path> [--apply] [--simulate-repair] [--markdown-out <path>]',
    )
  }
  if (looksLikeD1BindingName(raw)) {
    throw new Error(`Refusing repair-raw-linkage-report execution: "${raw}" looks like a D1 binding name.`)
  }
  const resolved = path.resolve(raw)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Local SQLite file not found: ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`Path is not a file: ${resolved}`)
  }
  return resolved
}

function defaultMarkdownPath(dbPath: string): string {
  const base = path.basename(dbPath, path.extname(dbPath))
  return path.resolve(path.dirname(dbPath), `${base}.raw-linkage-summary.md`)
}

export function parseRawLinkageReportConfig(args: string[]): RawLinkageReportConfig {
  if (hasRemoteFlag(args)) {
    throw new Error('Refusing repair-raw-linkage-report execution: --remote is not allowed for offline tooling.')
  }

  let apply = false
  let simulateRepair = false
  let markdownOutPath: string | null = null
  const positional: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === '--apply') {
      apply = true
      continue
    }
    if (token === '--simulate-repair') {
      simulateRepair = true
      continue
    }
    if (token === '--markdown-out') {
      const value = args[i + 1]
      i += 1
      if (!value || value.startsWith('--')) {
        throw new Error('--markdown-out requires a file path value')
      }
      markdownOutPath = path.resolve(value)
      continue
    }
    if (token.startsWith('--')) {
      continue
    }
    positional.push(token)
  }

  const dbPath = resolveExistingLocalDbPath(positional[0] || '')
  return {
    dbPath,
    apply,
    simulateRepair,
    markdownOutPath: markdownOutPath || defaultMarkdownPath(dbPath),
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function runRawLinkageReport(config: RawLinkageReportConfig): Record<string, unknown> {
  const preview = runRawLinkageRepairPreview({
    dbPath: config.dbPath,
    apply: config.apply,
    simulateRepair: config.simulateRepair,
  })
  const markdown = buildRawLinkageMarkdownSummary(preview)
  fs.writeFileSync(config.markdownOutPath, markdown, 'utf8')

  return {
    ok: true,
    phase: 'offline_report',
    mode: preview.mode,
    db_path: preview.db_path,
    markdown_output_path: config.markdownOutPath,
    markdown_sha256: sha256(markdown),
    orphan_count: preview.orphan_count,
    orphan_hashes_count: preview.orphan_hashes_count,
    candidate_raw_objects_count: preview.candidate_raw_objects_count,
    classification: preview.classification,
    deterministic_hashes: preview.deterministic_hashes,
    shadow_tables: preview.shadow_tables,
    generated_at: preview.generated_at,
    exit_code: 0,
  }
}

type ReportCliOptions = {
  stdoutWrite?: (text: string) => void
}

export function runRawLinkageReportCli(args: string[], options?: ReportCliOptions): number {
  const stdoutWrite = options?.stdoutWrite ?? ((text: string) => process.stdout.write(text))
  try {
    const config = parseRawLinkageReportConfig(args)
    const report = runRawLinkageReport(config)
    stdoutWrite(`${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    const failure = {
      ok: false,
      phase: 'offline_report',
      error: (error as Error)?.message || String(error),
      exit_code: 1,
    }
    stdoutWrite(`${JSON.stringify(failure)}\n`)
    return 1
  }
}

export function main(args: string[]): void {
  process.exitCode = runRawLinkageReportCli(args)
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
}
