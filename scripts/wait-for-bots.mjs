#!/usr/bin/env node
/**
 * Pre-merge new-PR bot wait enforcer.
 * Auto-detects the open PR for the current topic branch, finds when it was
 * created, and exits 2 (with time remaining) if MIN_WAIT_MINUTES haven't
 * elapsed yet. Exits 0 when the wait is satisfied or the check doesn't apply.
 *
 * This covers the "new PR" wait trigger. After tagging bots in PR comments or
 * review replies, agents must manually wait 7 minutes before the next sweep.
 *
 * Usage: node scripts/wait-for-bots.mjs
 * Or:    npm run wait-for-bots
 */
import { execSync, spawnSync } from 'node:child_process';

const MIN_WAIT_MINUTES = 7;

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

function openPr(branch) {
  const json = ghOut(['pr', 'list', '--state', 'open', '--head', branch, '--json', 'number,createdAt']);
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    return arr.length > 0 ? arr[0] : null;
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

const pr = openPr(branch);
if (!pr || !pr.number || !pr.createdAt) process.exit(0);

const createdAt = new Date(pr.createdAt);
if (!Number.isFinite(createdAt.getTime())) process.exit(0);

const elapsedMs = Date.now() - createdAt.getTime();
const elapsedMin = elapsedMs / 60000;
const remainingMin = Math.ceil(MIN_WAIT_MINUTES - elapsedMin);

if (elapsedMin < MIN_WAIT_MINUTES) {
  const readyAt = new Date(createdAt.getTime() + MIN_WAIT_MINUTES * 60000);
  console.log(
    `>>> BOT WAIT: PR created ${Math.floor(elapsedMin)} min ago - ` +
      `wait ${remainingMin} more min before sweeping (minimum: ${MIN_WAIT_MINUTES} min).`,
  );
  console.log(`>>> PR #${pr.number} - re-sweep bots after ${readyAt.toISOString()}`);
  console.log(
    '>>> This wait applies to new PR creation. Do not restart it only because you pushed code.',
  );
  process.exit(2);
}

console.log(
  `Bot wait satisfied: PR created ${Math.floor(elapsedMin)} min ago (minimum: ${MIN_WAIT_MINUTES} min). Clear to sweep.`,
);
process.exit(0);
