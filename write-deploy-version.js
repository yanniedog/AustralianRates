/**
 * Writes site/version.json with the commit SHA (and optional branch) for the current deploy.
 * Use in Cloudflare Pages build so the frontend can compare deployed version to GitHub HEAD.
 * Reads CF_PAGES_COMMIT_SHA / CF_PAGES_BRANCH when set (Pages CI), else falls back to git.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const commit = process.env.CF_PAGES_COMMIT_SHA || getGitCommit();
const branch = process.env.CF_PAGES_BRANCH || getGitBranch();

const shortCommit = commit ? commit.slice(0, 7) : '';

const outDir = path.join(__dirname, 'site');
const outPath = path.join(outDir, 'version.json');

const payload = {
  commit: commit || null,
  shortCommit: shortCommit || null,
  branch: branch || null
};

if (!fs.existsSync(outDir)) {
  console.error('write-deploy-version.js: site/ directory not found');
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 0) + '\n', 'utf8');
console.log('Wrote', outPath, shortCommit || '(no commit)');

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}
