'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEST_ROOTS = [
  path.join(ROOT, 'workers', 'api', 'test'),
  path.join(ROOT, 'workers', 'archive', 'test'),
];

const checks = [
  { label: 'vi.mock', pattern: /\bvi\.mock\s*\(/g },
  { label: 'jest.mock', pattern: /\bjest\.mock\s*\(/g },
  { label: 'mockResolvedValue', pattern: /\bmockResolvedValue(?:Once)?\s*\(/g },
  { label: 'mockRejectedValue', pattern: /\bmockRejectedValue(?:Once)?\s*\(/g },
  { label: 'vi.stubGlobal', pattern: /\bvi\.stubGlobal\s*\(/g },
  { label: 'globalThis.fetch reassignment', pattern: /\bglobalThis\.fetch\s*=/g },
  { label: "DatabaseSync(':memory:')", pattern: /\bDatabaseSync\s*\(\s*['"]\:memory\:['"]\s*\)/g },
  { label: 'CREATE TABLE via local test SQL', pattern: /(?:\.exec|\bexec)\s*\(\s*['"`][\s\S]*?\bCREATE\s+TABLE\b/gi },
  { label: 'INSERT INTO via local test SQL', pattern: /(?:\.prepare|\.exec|\bprepare|\bexec)\s*\(\s*['"`][\s\S]*?\bINSERT\s+INTO\b/gi },
  { label: 'fake D1 prepare(sql: string)', pattern: /\bprepare\s*\(\s*sql\s*:\s*string\s*\)/g },
  { label: 'fake D1 prepare() stub', pattern: /\bprepare\s*\(\s*\)\s*\{/g },
  { label: 'simulated CLI stdout JSON', pattern: /\bstdout\s*:\s*JSON\.stringify\s*\(/g },
];

function listFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(?:test|spec)\.ts$/i.test(entry.name)) {
      out.push(full);
      continue;
    }
    if (entry.isFile() && /\.(?:ts|mts|cts)$/i.test(entry.name) && !/\.d\.ts$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
const files = [];

for (const testRoot of TEST_ROOTS) {
  if (!fs.existsSync(testRoot)) {
    console.error(`[test-data-policy] test directory not found: ${testRoot}`);
    process.exit(1);
  }
  files.push(...listFiles(testRoot));
}

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const check of checks) {
    check.pattern.lastIndex = 0;
    if (check.pattern.test(text)) {
      violations.push(`${rel}: disallowed test pattern (${check.label})`);
    }
  }
}

if (violations.length > 0) {
  console.error('[test-data-policy] violations found:');
  for (const issue of violations) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[test-data-policy] PASS: ${files.length} worker test files satisfy strict real-data policy.`);
