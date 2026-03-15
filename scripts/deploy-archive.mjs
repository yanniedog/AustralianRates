import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const archiveWorkdir = path.resolve(__dirname, '..', 'workers', 'archive')
const wranglerCli = path.resolve(__dirname, '..', 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js')
const forwardedArgs = process.argv.slice(2)
const envArg = extractEnvArg(forwardedArgs)
const argsWithoutEnv = stripEnvArg(forwardedArgs)
const targets = envArg ? [envArg] : ['dev', 'prod']

for (const target of targets) {
  console.log(`\n[deploy:archive] deploying ${target}`)
  const result = spawnSync(process.execPath, [wranglerCli, 'deploy', '--env', target, ...argsWithoutEnv], {
    cwd: archiveWorkdir,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function extractEnvArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || '')
    if (value === '--env') {
      return String(args[index + 1] || '').trim() || null
    }
    if (value.startsWith('--env=')) {
      return value.slice('--env='.length).trim() || null
    }
  }
  return null
}

function stripEnvArg(args) {
  const stripped = []
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || '')
    if (value === '--env') {
      index += 1
      continue
    }
    if (value.startsWith('--env=')) {
      continue
    }
    stripped.push(value)
  }
  return stripped
}
