#!/usr/bin/env node
/**
 * Pre-merge bot wait enforcer.
 * Auto-detects the open PR for the current topic branch, finds when ci_result
 * turned green, and exits 2 (with time remaining) if MIN_WAIT_MINUTES haven't
 * elapsed yet. Exits 0 when the wait is satisfied or the check doesn't apply.
 *
 * Usage: node scripts/wait-for-bots.mjs
 * Or:    npm run wait-for-bots
 */
import { execSync, spawnSync } from 'node:child_process';

const MIN_WAIT_MINUTES = 20;

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function ghOut(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0 || !r.stdout) return '';
  return r.stdout.trim();
}

function hasGh() {
  return spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;
}

function currentBranch() {
  return sh('git rev-parse --abbrev-ref HEAD');
}

function isTopicBranch(b) {
  return /^(agent|feat|fix)\//.test(b);
}

function openPrNumber(branch) {
  const json = ghOut(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName']);
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    const hit = arr.find((r) => r.headRefName === branch);
    return hit ? hit.number : null;
  } catch {
    return null;
  }
}

function ciGreenAt(prNumber) {
  const json = ghOut(['pr', 'checks', String(prNumber), '--json', 'name,state,completedAt']);
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    const ci = arr.find((c) => c.name === 'ci_result' && c.state === 'SUCCESS');
    if (!ci || !ci.completedAt) return null;
    return new Date(ci.completedAt);
  } catch {
    return null;
  }
}

const branch = currentBranch();
if (!branch || !isTopicBranch(branch)) process.exit(0);
if (!hasGh()) {
  console.log('(Install gh CLI for bot wait enforcement on topic branches.)');
  process.exit(0);
}

const prNumber = openPrNumber(branch);
if (!prNumber) process.exit(0);

const greenAt = ciGreenAt(prNumber);
if (!greenAt) process.exit(0);

const elapsedMs = Date.now() - greenAt.getTime();
const elapsedMin = elapsedMs / 60000;
const remainingMin = Math.ceil(MIN_WAIT_MINUTES - elapsedMin);

if (elapsedMin < MIN_WAIT_MINUTES) {
  const readyAt = new Date(greenAt.getTime() + MIN_WAIT_MINUTES * 60000);
  console.log(
    `>>> BOT WAIT: ci_result green ${Math.floor(elapsedMin)} min ago — ` +
      `wait ${remainingMin} more min before sweeping (minimum: ${MIN_WAIT_MINUTES} min).`,
  );
  console.log(`>>> PR #${prNumber} — re-sweep bots after ${readyAt.toISOString()}`);
  console.log(
    '>>> This wait is unconditional — early bot threads do not mean all bots have finished.',
  );
  process.exit(2);
}

console.log(
  `Bot wait satisfied: ci_result green ${Math.floor(elapsedMin)} min ago (minimum: ${MIN_WAIT_MINUTES} min). Clear to sweep.`,
);
process.exit(0);
