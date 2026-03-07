'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  path.join(ROOT, 'site', 'index.html'),
  path.join(ROOT, 'site', 'savings', 'index.html'),
  path.join(ROOT, 'site', 'term-deposits', 'index.html'),
];

const allowedExternalStyles = new Set([
  'https://fonts.googleapis.com/css2?family=Merriweather:wght@700;900&family=Space+Grotesk:wght@400;500;600;700&display=swap',
]);

const requiredVendorSnippets = [
  'vendor/tabulator/tabulator_midnight.min.css',
  'vendor/pivottable/pivot.min.css',
  'vendor/tabulator/tabulator.min.js',
  'vendor/jquery/jquery.min.js',
  'vendor/jquery-ui/jquery-ui.min.js',
  'vendor/pivottable/pivot.min.js',
  'vendor/plotly/plotly-basic-2.35.2.min.js',
  'vendor/pivottable/plotly_renderers.min.js',
  'vendor/echarts/echarts.min.js',
  'vendor/sheetjs/xlsx.full.min.js',
];

function collectMatches(pattern, text) {
  const out = [];
  let m = null;
  while ((m = pattern.exec(text)) !== null) out.push(m[1]);
  return out;
}

const violations = [];

for (const file of FILES) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const scriptSrcs = collectMatches(/<script[^>]+src="([^"]+)"/g, text);
  const styleHrefs = collectMatches(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g, text);

  for (const src of scriptSrcs) {
    if (/^https?:\/\//i.test(src)) {
      violations.push(`${rel}: external script source is not allowed (${src})`);
    }
  }

  for (const href of styleHrefs) {
    if (/^https?:\/\//i.test(href) && !allowedExternalStyles.has(href)) {
      violations.push(`${rel}: external stylesheet source is not allowed (${href})`);
    }
  }

  for (const vendorSnippet of requiredVendorSnippets) {
    const expected = rel === 'site/index.html' ? vendorSnippet : `../${vendorSnippet}`;
    if (!text.includes(expected)) {
      violations.push(`${rel}: missing required vendor asset reference (${expected})`);
    }
  }
}

if (violations.length > 0) {
  console.error('[check-public-assets] violations found:');
  for (const issue of violations) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('[check-public-assets] PASS: public pages reference local vendor assets only.');
