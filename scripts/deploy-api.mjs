import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const forwardedArgs = process.argv.slice(2)
const dryRunRequested = forwardedArgs.includes('--dry-run')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiWorkdir = path.resolve(__dirname, '..', 'workers', 'api')

const wranglerCli = path.resolve(__dirname, '..', 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js')
const wranglerBin = process.execPath
const wranglerArgs = [wranglerCli, 'deploy', ...forwardedArgs]

const stdoutChunks = []
const stderrChunks = []

const child = spawn(wranglerBin, wranglerArgs, {
  cwd: apiWorkdir,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => {
  stdoutChunks.push(chunk)
  process.stdout.write(chunk)
})

child.stderr.on('data', (chunk) => {
  stderrChunks.push(chunk)
  process.stderr.write(chunk)
})

child.on('error', (error) => {
  console.error(`Failed to execute Wrangler deploy: ${error.message}`)
  process.exit(1)
})

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`Wrangler deploy terminated by signal ${signal}`)
    process.exit(1)
  }

  const combinedOutput = Buffer.concat([...stdoutChunks, ...stderrChunks]).toString('utf8')

  if (dryRunRequested) {
    const dryRunApplied = combinedOutput.includes('--dry-run: exiting now.')
    const appearsDeployed = combinedOutput.includes('Current Version ID:') || combinedOutput.includes('Deployed ')
    if (!dryRunApplied) {
      console.error('Guard failure: --dry-run was requested but Wrangler did not confirm dry-run mode.')
      process.exit(2)
    }
    if (appearsDeployed) {
      console.error('Guard failure: --dry-run was requested but deploy output indicates a real deploy occurred.')
      process.exit(3)
    }
  }

  process.exit(code ?? 1)
})
