'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = path.join(ROOT, 'workers', 'api', 'test');

const checks = [
  { label: 'it.skip', pattern: /\bit\.skip\s*\(/g },
  { label: 'test.skip', pattern: /\btest\.skip\s*\(/g },
  { label: 'describe.skip', pattern: /\bdescribe\.skip\s*\(/g },
  { label: 'vi.mock', pattern: /\bvi\.mock\s*\(/g },
  { label: 'jest.mock', pattern: /\bjest\.mock\s*\(/g },
  { label: 'mockResolvedValue', pattern: /\bmockResolvedValue(?:Once)?\s*\(/g },
  { label: 'mockRejectedValue', pattern: /\bmockRejectedValue(?:Once)?\s*\(/g },
  { label: 'globalThis.fetch reassignment', pattern: /\bglobalThis\.fetch\s*=/g },
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
    if (entry.isFile() && /\.test\.ts$/i.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(TEST_ROOT)) {
  console.error(`[api-test-policy] test directory not found: ${TEST_ROOT}`);
  process.exit(1);
}

const violations = [];
const files = listFiles(TEST_ROOT);

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const check of checks) {
    if (check.pattern.test(text)) {
      violations.push(`${rel}: disallowed test pattern (${check.label})`);
    }
  }
}

if (violations.length > 0) {
  console.error('[api-test-policy] violations found:');
  for (const issue of violations) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[api-test-policy] PASS: ${files.length} API test files satisfy strict policy.`);
