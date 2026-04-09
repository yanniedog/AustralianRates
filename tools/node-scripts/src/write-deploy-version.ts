/**
 * Site static cache busting for local .css / .js href/src:
 * `?v=` is the first 10 hex chars of SHA-256(file bytes). HTML is rewritten only
 * when a referenced asset’s content changes (not on every git commit).
 * `version.json` still records deploy commit metadata for diagnostics.
 */
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

const LOCAL_ASSET_IN_HTML_RE =
  /\b(href|src)="([^"]+\.(?:css|js))((?:\?[^"#]*)?)((?:#[^"]*)?)"/gi;

function parseVQuery(queryWithQ: string): string | null {
  if (!queryWithQ || queryWithQ[0] !== '?') return null;
  return new URLSearchParams(queryWithQ.slice(1)).get('v');
}

/** Fail fast: every local .css/.js in site HTML must have ?v= first 10 hex of SHA-256(file). */
export function verifyHtmlAssetStamps(siteDir: string, repoRootForMessages: string): string[] {
  const errors: string[] = [];
  const htmlFiles = collectFiles(siteDir, '.html');

  for (const filePath of htmlFiles) {
    const html = fs.readFileSync(filePath, 'utf8');
    LOCAL_ASSET_IN_HTML_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LOCAL_ASSET_IN_HTML_RE.exec(html)) !== null) {
      const rawPath = m[2];
      const queryPart = m[3] || '';
      if (!isLocalAssetUrl(rawPath)) continue;
      const abs = resolveSiteAssetFile(siteDir, filePath, rawPath);
      const relHtml = path.relative(repoRootForMessages, filePath);
      if (!abs) {
        errors.push(`${relHtml}: could not resolve ${rawPath}`);
        continue;
      }
      const expected = shortContentHash(abs);
      const got = parseVQuery(queryPart);
      if (got !== expected) {
        errors.push(`${relHtml}: ${rawPath} ?v= expected ${expected}, got ${got ?? '(missing)'}`);
      }
    }
  }
  return errors;
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
  const next = html.replace(LOCAL_ASSET_IN_HTML_RE, (full, attr, rawUrl, _q, frag = '') => {
    if (!isLocalAssetUrl(rawUrl)) {
      return full;
    }
    const abs = resolveSiteAssetFile(siteDir, htmlFilePath, rawUrl);
    if (!abs) {
      errors.push(`${rawUrl} (from ${path.relative(repoRoot, htmlFilePath)})`);
      return `${attr}="${rawUrl}?v=${safeFallback}${frag}"`;
    }
    const v = shortContentHash(abs);
    return `${attr}="${rawUrl}?v=${v}${frag}"`;
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
  if (process.argv.includes('--check')) {
    const errors = verifyHtmlAssetStamps(outDir, repoRoot);
    if (errors.length > 0) {
      console.error('[check:site-asset-stamps] HTML ?v= does not match file content:');
      for (const e of errors) console.error(' ', e);
      console.error('Fix: npm run stamp:site-assets  (or npm run build)');
      process.exit(1);
    }
    console.log('[check:site-asset-stamps] PASS: local .js/.css ?v= match content hashes');
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 0) + '\n', 'utf8');
  const { total, updated } = rewriteHtmlAssets(outDir, assetVersion);
  console.log('Wrote', outPath, shortCommit || '(no commit)');
  console.log('Stamped', total, 'HTML file(s);', updated, 'updated (content ?v= per .css/.js file)');
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
