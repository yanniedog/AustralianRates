/**
 * Beta test: traverse all public pages on australianrates.com, capture client log
 * and console output, write to a log file for analysis.
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const TARGET = process.env.TEST_URL || 'https://www.australianrates.com/';
const OUT_FILE = process.env.BETA_LOG_FILE || path.join(process.cwd(), 'docs', 'beta-test-client-log.txt');

const PUBLIC_URLS: Array<{ path: string; label: string; waitTable?: boolean }> = [
  { path: '/', label: 'Home (Home Loans)', waitTable: true },
  { path: '/savings/', label: 'Savings', waitTable: true },
  { path: '/term-deposits/', label: 'Term Deposits', waitTable: true },
  { path: '/about/', label: 'About' },
  { path: '/privacy/', label: 'Privacy' },
  { path: '/terms/', label: 'Terms' },
  { path: '/contact/', label: 'Contact' },
  { path: '/does-not-exist', label: '404' },
];

interface LogEntry {
  ts: string;
  level: string;
  message: string;
  detail?: unknown;
}

interface PageCapture {
  url: string;
  label: string;
  clientLog: LogEntry[];
  consoleEntries: Array<{ type: string; text: string }>;
  pageErrors: string[];
}

function formatClientLog(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const parts = [e.ts, `[${(e.level || 'info').toUpperCase()}]`, e.message];
      if (e.detail != null && typeof e.detail === 'object') parts.push(JSON.stringify(e.detail));
      else if (e.detail != null) parts.push(String(e.detail));
      return parts.join(' ');
    })
    .join('\n');
}

async function run(): Promise<void> {
  const base = new URL(TARGET).origin;
  const captures: PageCapture[] = [];
  const consoleEntries: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => consoleEntries.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => pageErrors.push(err.message));

  for (const { path: p, label, waitTable } of PUBLIC_URLS) {
    consoleEntries.length = 0;
    pageErrors.length = 0;
    const url = base + p;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForSelector('#main-content', { timeout: 10000 }).catch(() => {});
      if (waitTable) {
        await page.waitForSelector('#rate-table', { timeout: 15000 }).catch(() => {});
        await page.waitForFunction(
          () => {
            const rows = document.querySelectorAll('#rate-table .tabulator-row');
            const placeholder = document.querySelector('#rate-table .tabulator-placeholder');
            return rows.length > 0 || (placeholder && (placeholder.textContent || '').trim().length > 0);
          },
          null,
          { timeout: 20000 }
        ).catch(() => {});
      }
      await page.waitForTimeout(1500);
    } catch (e) {
      // still capture log for failed navigations
    }

    const clientLog = await page
      .evaluate(() => {
        if (typeof (window as unknown as { getSessionLogEntries?: () => LogEntry[] }).getSessionLogEntries !== 'function')
          return [];
        return (window as unknown as { getSessionLogEntries: () => LogEntry[] }).getSessionLogEntries();
      })
      .catch(() => []);

    captures.push({
      url: page.url(),
      label,
      clientLog,
      consoleEntries: [...consoleEntries],
      pageErrors: [...pageErrors],
    });
  }

  await browser.close();

  const lines: string[] = [
    '# AustralianRates beta test – client log capture',
    `# Captured at ${new Date().toISOString()}`,
    `# Target: ${TARGET}`,
    '',
  ];

  for (const cap of captures) {
    lines.push(`## ${cap.label} (${cap.url})`);
    lines.push(`Client log entries: ${cap.clientLog.length}`);
    if (cap.clientLog.length > 0) {
      lines.push(formatClientLog(cap.clientLog));
    }
    if (cap.pageErrors.length > 0) {
      lines.push('Page errors:');
      cap.pageErrors.forEach((e) => lines.push('  - ' + e));
    }
    const errs = cap.consoleEntries.filter((e) => e.type === 'error');
    if (errs.length > 0) {
      lines.push('Console errors:');
      errs.forEach((e) => lines.push('  - ' + (e.text || '').slice(0, 300)));
    }
    lines.push('');
  }

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log('Wrote client log capture to', OUT_FILE);

  const totalEntries = captures.reduce((s, c) => s + c.clientLog.length, 0);
  const errorEntries = captures.reduce(
    (s, c) => s + c.clientLog.filter((e) => (e.level || '').toLowerCase() === 'error').length,
    0
  );
  const abnormalityEntries = captures.reduce(
    (s, c) => s + c.clientLog.filter((e) => (e.message || '').includes('EXPLORER_TABLE_ABNORMALITY')).length,
    0
  );
  const totalPageErrors = pageErrors.length;
  const totalConsoleErrors = consoleEntries.filter((e) => e.type === 'error').length;

  console.log('Summary: pages=', captures.length, 'clientLogEntries=', totalEntries, 'clientLogErrors=', errorEntries, 'abnormality=', abnormalityEntries, 'pageErrors=', totalPageErrors, 'consoleErrors=', totalConsoleErrors);
}

void run().catch((err) => {
  console.error('beta-test-capture-log failed:', err);
  process.exit(1);
});
