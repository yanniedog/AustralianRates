import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const commit = process.env.CF_PAGES_COMMIT_SHA || getGitCommit();
const branch = process.env.CF_PAGES_BRANCH || getGitBranch();
const shortCommit = sanitizeVersionToken(commit ? commit.slice(0, 7) : '');
const commitDate = getGitCommitDate();
const buildTime = new Date().toISOString();

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, 'site');
const outPath = path.join(outDir, 'version.json');
const assetVersion = shortCommit || sanitizeVersionToken(branch) || 'dev';

const payload = {
  commit: commit || null,
  shortCommit: shortCommit || null,
  branch: branch || null,
  buildTime: buildTime,
  commitDate: commitDate || null,
};

if (!fs.existsSync(outDir)) {
  console.error('write-deploy-version.ts: site/ directory not found');
  process.exit(1);
}

export function stampLocalAssetUrls(html: string, version: string): string {
  const safeVersion = sanitizeVersionToken(version) || 'dev';
  return html.replace(/\b(href|src)="([^"]+\.(?:css|js))(?:\?[^"#]*)?(#[^"]*)?"/gi, (full, attr, rawUrl, hash = '') => {
    if (!isLocalAssetUrl(rawUrl)) {
      return full;
    }
    return `${attr}="${rawUrl}?v=${safeVersion}${hash}"`;
  });
}

function rewriteHtmlAssets(siteDir: string, version: string): number {
  const htmlFiles = collectFiles(siteDir, '.html');
  htmlFiles.forEach((filePath) => {
    const next = stampLocalAssetUrls(fs.readFileSync(filePath, 'utf8'), version);
    fs.writeFileSync(filePath, next, 'utf8');
  });
  return htmlFiles.length;
}

function collectFiles(rootDir: string, extension: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const out: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(fullPath, extension));
      continue;
    }
    if (entry.isFile() && fullPath.toLowerCase().endsWith(extension)) {
      out.push(fullPath);
    }
  }

  return out;
}

function isLocalAssetUrl(url: string): boolean {
  return !/^(?:[a-z]+:)?\/\//i.test(url) && !/^(?:data|mailto|javascript):/i.test(url);
}

function sanitizeVersionToken(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function main() {
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 0) + '\n', 'utf8');
  const rewrittenCount = rewriteHtmlAssets(outDir, assetVersion);
  console.log('Wrote', outPath, shortCommit || '(no commit)');
  console.log('Stamped', rewrittenCount, 'HTML file(s) with asset version', assetVersion);
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}

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

function getGitCommitDate(): string {
  try {
    return execSync('git log -1 --format=%cI HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
