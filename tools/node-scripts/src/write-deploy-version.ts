import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const commit = process.env.CF_PAGES_COMMIT_SHA || getGitCommit();
const branch = process.env.CF_PAGES_BRANCH || getGitBranch();
const shortCommit = commit ? commit.slice(0, 7) : '';

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, 'site');
const outPath = path.join(outDir, 'version.json');

const payload = {
  commit: commit || null,
  shortCommit: shortCommit || null,
  branch: branch || null,
};

if (!fs.existsSync(outDir)) {
  console.error('write-deploy-version.ts: site/ directory not found');
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 0) + '\n', 'utf8');
console.log('Wrote', outPath, shortCommit || '(no commit)');

function getGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
