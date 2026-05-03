#!/usr/bin/env node
/**
 * Prints the shipping closeout checklist and optional gh warning if the current
 * branch still has an open PR (common sign the assistant stopped before merge).
 * Flags: --strict (or SHIP_CLOSEOUT_STRICT=1) exits 2 on agent/feat/fix when gh
 * reports an open PR for this head, or when gh is missing in strict mode.
 * See docs/ASSISTANT_SHIP_CLOSEOUT.md
 */
import { execSync, spawnSync } from 'node:child_process';

function strictEnabled() {
  return (
    process.argv.includes('--strict') ||
    String(process.env.SHIP_CLOSEOUT_STRICT ?? '') === '1'
  )
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function hasGh() {
  const r = spawnSync('gh', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

function ghOut(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0 || !r.stdout) return '';
  return r.stdout.trim();
}

function currentBranch() {
  return sh('git rev-parse --abbrev-ref HEAD');
}

function isTopicBranch(branch) {
  return /^(agent|feat|fix)\//.test(branch);
}

function openPrForHead(branch) {
  if (!branch) return null
  const json = ghOut([
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,url,headRefName',
  ])
  if (!json) return null
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return null
    const hit = arr.find((row) => String(row.headRefName || '') === branch)
    return hit && hit.url ? { number: hit.number, url: hit.url } : null
  } catch {
    return null
  }
}

const lines = [
  '=== Australian Rates - ship closeout (AGENTS.md steps 1-9) ===',
  '1. Branch from fresh origin/main (unless user ordered main hotfix)',
  '2. Commit + push',
  '3. PR to main',
  '4. CI green (ci_result, etc.)',
  '5. Bot wait gate: 7 min after new PR creation or bot tagging; code pushes alone do not restart it',
  '6. In-thread reply on every substantive bot/human thread',
  '7. Merge to main',
  '8. Deploy finished (Pages / Workers as applicable)',
  '9. npm run verify:prod -- --scope=auto --depth=smoke (exit 0) on www.australianrates.com',
  '',
  'Docs: docs/ASSISTANT_SHIP_CLOSEOUT.md',
  '',
];

console.log(lines.join('\n'));

const strict = strictEnabled();
const branch = currentBranch();
if (!branch) {
  process.exit(0);
}

if (branch === 'main' || branch === 'master') {
  console.log(`On ${branch}: if you just merged, run verify:prod after production deploy.\n`);
  process.exit(0);
}

if (isTopicBranch(branch) && strict && !hasGh()) {
  console.error(
    '>>> ship:closeout strict mode requires gh to detect an open PR; install gh or drop --strict.',
  );
  console.error('');
  process.exit(2);
}

if (!hasGh()) {
  console.log('(Install gh CLI for an open-PR warning on topic branches.)\n');
  process.exit(0);
}

if (isTopicBranch(branch)) {
  const pr = openPrForHead(branch);
  if (pr && pr.url) {
    console.log('>>> WARNING: Open PR on this branch - work may not be merged or verified yet.');
    console.log(`>>> ${pr.url}\n`);
    if (strict) {
      process.exit(2);
    }
  }
}

process.exit(0);
