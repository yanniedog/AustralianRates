import { spawnSync } from 'node:child_process'
import { createGunzip } from 'node:zlib'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdtemp, stat, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { resolveCliPath } from './cli-path'

type ImportBackupConfig = {
  dbName: string
  inputPath: string
  remote: boolean
  envName: string | null
  persistTo: string | null
  keepSql: boolean
  passthroughArgs: string[]
}

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir)
  while (true) {
    const packageJsonPath = path.join(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
        if (pkg.name === 'australianrates') return current
      } catch {
        // Keep walking.
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('Could not locate repo root. Run this command from inside the australianrates repository.')
}

const repoRoot = findRepoRoot(process.cwd())
const WRANGLER_BIN = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

function printHelp(): void {
  process.stdout.write(`
Usage:
  node scripts/import-d1-backup.js --db <d1_database_name> --input <dump.sql|dump.sql.gz> [--remote] [--env <name>] [--persist-to <dir>] [--keep-sql] [-- <extra wrangler args>]

Behavior:
  Validates that the input is an AustralianRates full dump, decompresses .sql.gz to a temporary .sql file, then runs wrangler d1 execute --file.
`)
}

function parseArgValue(args: string[], index: number): { value: string; nextIndex: number } {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`Missing value for ${args[index]}`)
  return { value, nextIndex: index + 1 }
}

function parseArgs(args: string[]): ImportBackupConfig {
  let dbName = ''
  let inputPath = ''
  let remote = false
  let envName: string | null = null
  let persistTo: string | null = null
  let keepSql = false
  const passthroughArgs: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    if (arg === '--') {
      passthroughArgs.push(...args.slice(i + 1))
      break
    }
    if (arg === '--db' || arg === '--database') {
      const parsed = parseArgValue(args, i)
      dbName = parsed.value
      i = parsed.nextIndex
      continue
    }
    if (arg === '--input') {
      const parsed = parseArgValue(args, i)
      inputPath = parsed.value
      i = parsed.nextIndex
      continue
    }
    if (arg === '--env') {
      const parsed = parseArgValue(args, i)
      envName = parsed.value
      i = parsed.nextIndex
      continue
    }
    if (arg === '--persist-to') {
      const parsed = parseArgValue(args, i)
      persistTo = parsed.value
      i = parsed.nextIndex
      continue
    }
    if (arg.startsWith('--db=')) {
      dbName = arg.split('=', 2)[1] ?? ''
      continue
    }
    if (arg.startsWith('--input=')) {
      inputPath = arg.split('=', 2)[1] ?? ''
      continue
    }
    if (arg.startsWith('--env=')) {
      envName = arg.split('=', 2)[1] ?? ''
      continue
    }
    if (arg.startsWith('--persist-to=')) {
      persistTo = arg.split('=', 2)[1] ?? ''
      continue
    }
    if (arg === '--remote') {
      remote = true
      continue
    }
    if (arg === '--keep-sql') {
      keepSql = true
      continue
    }
    passthroughArgs.push(arg)
  }

  if (!dbName.trim()) throw new Error('Missing required argument: --db <d1_database_name>')
  if (!inputPath.trim()) throw new Error('Missing required argument: --input <dump.sql|dump.sql.gz>')

  return {
    dbName: dbName.trim(),
    inputPath: resolveCliPath(inputPath),
    remote,
    envName: envName ? envName.trim() : null,
    persistTo: persistTo ? resolveCliPath(persistTo) : null,
    keepSql,
    passthroughArgs,
  }
}

function validateDumpSql(sql: string): void {
  if (!sql.includes('-- AustralianRates full database dump')) {
    throw new Error('Input file is not an AustralianRates full database dump.')
  }
  if (!sql.includes('-- End of AustralianRates full database dump')) {
    throw new Error('Dump footer marker is missing. The file may be truncated or incomplete.')
  }
}

async function materializeSqlInput(config: ImportBackupConfig): Promise<{ sqlPath: string; cleanupPath: string | null }> {
  if (!existsSync(config.inputPath)) throw new Error(`Input file not found: ${config.inputPath}`)
  if (config.inputPath.toLowerCase().endsWith('.sql')) {
    validateDumpSql(readFileSync(config.inputPath, 'utf8'))
    return { sqlPath: config.inputPath, cleanupPath: null }
  }
  if (!config.inputPath.toLowerCase().endsWith('.sql.gz') && !config.inputPath.toLowerCase().endsWith('.gz')) {
    throw new Error('Input must be a .sql or .sql.gz file.')
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ar-d1-import-'))
  const sqlPath = path.join(tempDir, path.basename(config.inputPath).replace(/\.gz$/i, ''))
  await pipeline(createReadStream(config.inputPath), createGunzip(), createWriteStream(sqlPath))
  validateDumpSql(readFileSync(sqlPath, 'utf8'))
  return { sqlPath, cleanupPath: config.keepSql ? null : sqlPath }
}

function runWranglerImport(config: ImportBackupConfig, sqlPath: string): void {
  const wranglerArgs = ['d1', 'execute', config.dbName]
  if (config.envName) wranglerArgs.push('--env', config.envName)
  if (config.remote) {
    wranglerArgs.push('--remote')
  } else {
    wranglerArgs.push('--local')
    if (config.persistTo) wranglerArgs.push('--persist-to', config.persistTo)
  }
  wranglerArgs.push('--file', sqlPath, ...config.passthroughArgs)

  process.stdout.write(`Running: ${process.execPath} ${WRANGLER_BIN} ${wranglerArgs.join(' ')}\n`)
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...wranglerArgs], {
    cwd: path.join(repoRoot, 'workers', 'api'),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw new Error(`wrangler import failed: ${result.error.message}`)
  if ((result.status ?? 1) !== 0) throw new Error(`wrangler import exited with code ${result.status}`)
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2))
  const materialized = await materializeSqlInput(config)
  runWranglerImport(config, materialized.sqlPath)
  const importedSize = (await stat(materialized.sqlPath)).size
  process.stdout.write(`Import source SQL: ${path.resolve(materialized.sqlPath)} (${importedSize} bytes)\n`)
  if (materialized.cleanupPath) await unlink(materialized.cleanupPath).catch(() => {})
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exitCode = 1
})
