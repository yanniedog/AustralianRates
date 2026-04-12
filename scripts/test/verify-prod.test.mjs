import test from 'node:test'
import assert from 'node:assert/strict'

import { buildVerifyPlan, resolveAutoScope } from '../verify-prod-lib.mjs'

test('resolveAutoScope maps site-only changes to site', () => {
  const resolved = resolveAutoScope(['site/index.html'])
  assert.deepEqual(resolved.scopes, ['site'])
  assert.equal(resolved.skipped, false)
})

test('resolveAutoScope maps api-only changes to api', () => {
  const resolved = resolveAutoScope(['workers/api/src/index.ts'])
  assert.deepEqual(resolved.scopes, ['api'])
})

test('resolveAutoScope maps archive-only changes to archive', () => {
  const resolved = resolveAutoScope(['workers/archive/src/index.ts'])
  assert.deepEqual(resolved.scopes, ['archive'])
})

test('resolveAutoScope escalates shared or workflow changes to full', () => {
  const resolved = resolveAutoScope(['package.json'])
  assert.deepEqual(resolved.scopes, ['full'])
})

test('resolveAutoScope skips docs-only changes', () => {
  const resolved = resolveAutoScope(['docs/TEST_PROTOCOL.md', 'README.md'])
  assert.deepEqual(resolved.scopes, [])
  assert.equal(resolved.skipped, true)
})

test('resolveAutoScope falls back to full when no files are known', () => {
  const resolved = resolveAutoScope([])
  assert.deepEqual(resolved.scopes, ['full'])
  assert.equal(resolved.reason, 'no_diff_fallback')
})

test('buildVerifyPlan composes site smoke commands', () => {
  const plan = buildVerifyPlan({ scope: 'site', depth: 'smoke' })
  assert.deepEqual(
    plan.commands.map((step) => step.command),
    ['npm run diagnose:pages', 'npm run test:homepage'],
  )
})

test('buildVerifyPlan composes api smoke commands', () => {
  const plan = buildVerifyPlan({ scope: 'api', depth: 'smoke' })
  assert.deepEqual(
    plan.commands.map((step) => step.command),
    ['npm run test:api', 'npm run diagnose:api:smoke'],
  )
})

test('buildVerifyPlan composes archive smoke commands', () => {
  const plan = buildVerifyPlan({ scope: 'archive', depth: 'smoke' })
  assert.deepEqual(
    plan.commands.map((step) => step.command),
    ['npm run test:archive'],
  )
})

test('buildVerifyPlan composes full-depth commands for full scope', () => {
  const plan = buildVerifyPlan({ scope: 'full', depth: 'full' })
  assert.deepEqual(
    plan.commands.map((step) => step.command),
    [
      'npm run test:api',
      'npm run test:archive',
      'npm run diagnose:api',
      'npm run diagnose:pages',
      'npm run test:homepage:full',
      'npm run verify:prod-hosting',
    ],
  )
})

test('buildVerifyPlan skips docs-only auto scope', () => {
  const plan = buildVerifyPlan({ scope: 'auto', depth: 'smoke', files: ['docs/CLOUDFLARE_USAGE.md'] })
  assert.equal(plan.skipped, true)
  assert.deepEqual(plan.commands, [])
})
