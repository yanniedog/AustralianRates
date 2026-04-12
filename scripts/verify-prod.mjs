#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process'
import process from 'node:process'
import {
  buildVerifyPlan,
  collectAutoScopeFiles,
  formatPlan,
  parseVerifyArgs,
} from './verify-prod-lib.mjs'

function runCommand(command, cwd) {
  const result = spawnSync(command, {
    cwd,
    env: process.env,
    shell: true,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return typeof result.status === 'number' ? result.status : 1
}

const cwd = process.cwd()
const { scope, depth } = parseVerifyArgs(process.argv.slice(2))
const files = scope === 'auto' ? collectAutoScopeFiles({ cwd, execSyncImpl: execSync }) : []
const plan = buildVerifyPlan({ scope, depth, files })

console.log(formatPlan(plan))
if (files.length > 0) {
  console.log(`changed files: ${files.join(', ')}`)
}

if (plan.skipped) {
  process.exit(0)
}

for (const step of plan.commands) {
  console.log(`\n[verify:prod] ${step.label}`)
  console.log(`[verify:prod] ${step.command}`)
  const code = runCommand(step.command, cwd)
  if (code !== 0) {
    process.exit(code)
  }
}
