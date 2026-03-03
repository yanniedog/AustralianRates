import { spawnSync } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

type ExportBackupConfig = {
  dbName: string
  remote: boolean
  outputDir: string
  allowRepoPath: boolean
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
        // Keep walking up if package.json cannot be parsed.
      }
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('Could not locate repo root. Run this command from inside the australianrates repository.')
}

const repoRoot = findRepoRoot(process.cwd())

function printHelp(): void {
  process.stdout.write(`
Usage:
  node scripts/export-d1-backup.js --db <d1_database_name> [--remote] [--output-dir <path>] [--allow-repo-path] [--keep-sql] [-- <extra wrangler args>]

Defaults:
  output-dir:
    Windows: %USERPROFILE%\\ar-backups
    macOS/Linux: ~/ar-backups
  format:
    Exports SQL then compresses to .sql.gz

Safety:
  Refuses to write backups inside the repository unless --allow-repo-path is provided.
`)
}

function parseArgValue(args: string[], index: number): { value: string; nextIndex: number } {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${args[index]}`)
  }
  return { value, nextIndex: index + 1 }
}

function defaultOutputDir(): string {
  const homeDir = os.homedir()
  if (!homeDir) throw new Error('Could not resolve home directory for backup output')
  return path.join(homeDir, 'ar-backups')
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function parseArgs(args: string[]): ExportBackupConfig {
  let dbName = ''
  let remote = false
  let outputDir = defaultOutputDir()
  let allowRepoPath = false
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

    if (arg.startsWith('--db=')) {
      dbName = arg.split('=', 2)[1] ?? ''
      continue
    }

    if (arg.startsWith('--database=')) {
      dbName = arg.split('=', 2)[1] ?? ''
      continue
    }

    if (arg === '--output-dir' || arg === '--out-dir') {
      const parsed = parseArgValue(args, i)
      outputDir = parsed.value
      i = parsed.nextIndex
      continue
    }

    if (arg.startsWith('--output-dir=')) {
      outputDir = arg.split('=', 2)[1] ?? ''
      continue
    }

    if (arg.startsWith('--out-dir=')) {
      outputDir = arg.split('=', 2)[1] ?? ''
      continue
    }

    if (arg === '--remote') {
      remote = true
      continue
    }

    if (arg === '--allow-repo-path') {
      allowRepoPath = true
      continue
    }

    if (arg === '--keep-sql') {
      keepSql = true
      continue
    }

    passthroughArgs.push(arg)
  }

  if (!dbName.trim()) {
    throw new Error('Missing required argument: --db <d1_database_name>')
  }

  const resolvedOutputDir = path.resolve(outputDir)
  const resolvedRepoRoot = path.resolve(repoRoot)
  if (!allowRepoPath && isPathInside(resolvedRepoRoot, resolvedOutputDir)) {
    throw new Error(
      `Refusing to write backup inside repo: ${resolvedOutputDir}. Use --allow-repo-path only if you explicitly want repo output.`,
    )
  }

  return {
    dbName: dbName.trim(),
    remote,
    outputDir: resolvedOutputDir,
    allowRepoPath,
    keepSql,
    passthroughArgs,
  }
}

function timestampUtc(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-')
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = bytes
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function runWranglerExport(config: ExportBackupConfig, sqlPath: string): void {
  const npxCommand = 'npx'
  const wranglerArgs = ['wrangler', 'd1', 'export', config.dbName]
  if (config.remote) wranglerArgs.push('--remote')
  wranglerArgs.push('--output', sqlPath, ...config.passthroughArgs)

  process.stdout.write(`Running: ${npxCommand} ${wranglerArgs.join(' ')}\n`)
  const result = spawnSync(npxCommand, wranglerArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    throw new Error(`wrangler export failed: ${result.error.message}`)
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`wrangler export exited with code ${result.status}`)
  }
}

async function gzipSql(sqlPath: string, gzipPath: string): Promise<void> {
  await pipeline(createReadStream(sqlPath), createGzip({ level: 9 }), createWriteStream(gzipPath))
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2))
  await mkdir(config.outputDir, { recursive: true })

  const backupBase = `${sanitizeName(config.dbName)}-${timestampUtc()}`
  const sqlPath = path.join(config.outputDir, `${backupBase}.sql`)
  const gzipPath = `${sqlPath}.gz`

  runWranglerExport(config, sqlPath)

  await stat(sqlPath)
  await gzipSql(sqlPath, gzipPath)
  if (!config.keepSql) {
    await unlink(sqlPath)
  }

  const finalArtifactPath = path.resolve(gzipPath)
  const finalSize = (await stat(finalArtifactPath)).size
  process.stdout.write(`Backup artifact: ${finalArtifactPath}\n`)
  process.stdout.write(`Backup size: ${finalSize} bytes (${formatBytes(finalSize)})\n`)
  if (config.keepSql) {
    const sqlSize = (await stat(sqlPath)).size
    process.stdout.write(`Raw SQL retained: ${path.resolve(sqlPath)} (${sqlSize} bytes)\n`)
  }
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exitCode = 1
})
