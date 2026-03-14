'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLARITY_PROJECT_ID = 'vt4vtenviy';
const SITE_VARIANT_PATH = path.join(ROOT, 'site', 'site-variant.js');
const PRIVACY_PATH = path.join(ROOT, 'site', 'privacy', 'index.html');
const PUBLIC_HTML_FILES = [
  path.join(ROOT, 'site', 'index.html'),
  path.join(ROOT, 'site', 'about', 'index.html'),
  path.join(ROOT, 'site', 'contact', 'index.html'),
  path.join(ROOT, 'site', 'privacy', 'index.html'),
  path.join(ROOT, 'site', 'savings', 'index.html'),
  path.join(ROOT, 'site', 'term-deposits', 'index.html'),
  path.join(ROOT, 'site', 'terms', 'index.html'),
];

const violations = [];

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function expectIncludes(filePath, text, needle, message) {
  if (!text.includes(needle)) {
    violations.push(`${rel(filePath)}: ${message}`);
  }
}

function expectMatches(filePath, text, pattern, message) {
  if (!pattern.test(text)) {
    violations.push(`${rel(filePath)}: ${message}`);
  }
}

const siteVariant = fs.readFileSync(SITE_VARIANT_PATH, 'utf8');
expectIncludes(SITE_VARIANT_PATH, siteVariant, `var clarityProjectId = '${CLARITY_PROJECT_ID}';`, `missing hardcoded Clarity project id ${CLARITY_PROJECT_ID}`);
expectIncludes(SITE_VARIANT_PATH, siteVariant, "script.src = 'https://www.clarity.ms/tag/' + projectId;", 'missing canonical Clarity tag source');
expectIncludes(SITE_VARIANT_PATH, siteVariant, "script.id = 'ar-clarity-tag';", 'missing stable Clarity script id');
expectIncludes(SITE_VARIANT_PATH, siteVariant, 'window.clarity = window.clarity || function ()', 'missing window.clarity bootstrap');
expectIncludes(SITE_VARIANT_PATH, siteVariant, 'initClarity(clarityProjectId);', 'Clarity bootstrap is not invoked on page load');
expectIncludes(SITE_VARIANT_PATH, siteVariant, 'clarityEnabled: !isLocalHost,', 'Clarity enabled flag is missing from the site variant contract');

for (const filePath of PUBLIC_HTML_FILES) {
  const html = fs.readFileSync(filePath, 'utf8');
  expectMatches(
    filePath,
    html,
    /<script[^>]+src="(?:\.\.\/)?site-variant\.js(?:\?v=[^"]+)?"><\/script>/i,
    'missing site-variant.js loader on a public/legal page',
  );
}

const privacyHtml = fs.readFileSync(PRIVACY_PATH, 'utf8');
expectIncludes(PRIVACY_PATH, privacyHtml, 'Microsoft Clarity', 'privacy policy must disclose Microsoft Clarity');
expectIncludes(PRIVACY_PATH, privacyHtml, 'Clarity analytics are used to understand navigation friction', 'privacy policy is missing the Clarity usage statement');
expectIncludes(PRIVACY_PATH, privacyHtml, 'Clarity may use cookies or similar browser storage', 'privacy policy is missing the Clarity storage disclosure');

if (violations.length > 0) {
  console.error('[check-clarity-installation] violations found:');
  for (const issue of violations) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[check-clarity-installation] PASS: Clarity ${CLARITY_PROJECT_ID} is hardwired into the public site and disclosed in privacy copy.`);
