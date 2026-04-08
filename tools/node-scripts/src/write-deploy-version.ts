import crypto from 'node:crypto';
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

const hashCache = new Map<string, string>();

function shortContentHash(absPath: string): string {
  let h = hashCache.get(absPath);
  if (!h) {
    const buf = fs.readFileSync(absPath);
    h = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
    hashCache.set(absPath, h);
  }
  return h;
}

function isUnderRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveSiteAssetFile(siteDir: string, htmlFilePath: string, rawUrl: string): string | null {
  const siteRoot = path.resolve(siteDir);
  const base = rawUrl.split('#')[0].split('?')[0];
  let abs: string;
  if (base.startsWith('/')) {
    abs = path.join(siteRoot, base.slice(1));
  } else {
    abs = path.join(path.dirname(htmlFilePath), base);
  }
  const resolved = path.resolve(abs);
  if (!isUnderRoot(siteRoot, resolved)) {
    return null;
  }
  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

/** Per-file content hash on ?v=; HTML only changes when referenced .css/.js bytes change. */
export function stampLocalAssetUrls(
  html: string,
  siteDir: string,
  htmlFilePath: string,
  fallbackVersion: string,
): string {
  const safeFallback = sanitizeVersionToken(fallbackVersion) || 'dev';
  const errors: string[] = [];
  const next = html.replace(/\b(href|src)="([^"]+\.(?:css|js))(?:\?[^"#]*)?(#[^"]*)?"/gi, (full, attr, rawUrl, hash = '') => {
    if (!isLocalAssetUrl(rawUrl)) {
      return full;
    }
    const abs = resolveSiteAssetFile(siteDir, htmlFilePath, rawUrl);
    if (!abs) {
      errors.push(`${rawUrl} (from ${path.relative(repoRoot, htmlFilePath)})`);
      return `${attr}="${rawUrl}?v=${safeFallback}${hash}"`;
    }
    const v = shortContentHash(abs);
    return `${attr}="${rawUrl}?v=${v}${hash}"`;
  });
  if (errors.length > 0) {
    console.error('write-deploy-version.ts: could not resolve local asset(s):');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  return next;
}

function rewriteHtmlAssets(siteDir: string, version: string): { total: number; updated: number } {
  const htmlFiles = collectFiles(siteDir, '.html');
  let updated = 0;
  for (const filePath of htmlFiles) {
    const prev = fs.readFileSync(filePath, 'utf8');
    const next = stampLocalAssetUrls(prev, siteDir, filePath, version);
    if (next !== prev) {
      fs.writeFileSync(filePath, next, 'utf8');
      updated += 1;
    }
  }
  return { total: htmlFiles.length, updated };
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
