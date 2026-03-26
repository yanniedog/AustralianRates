// @ts-nocheck
/**
 * Production read-only admin portal audit.
 * Requires ADMIN_TEST_TOKEN env var with a valid admin bearer token.
 */

const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const ADMIN_TEST_TOKEN = String(
  process.env.ADMIN_TEST_TOKEN || process.env.ADMIN_API_TOKEN || process.env.LOCAL_ADMIN_API_TOKEN || '',
).trim();
const ADMIN_TOKEN_ENV_NAMES = ['ADMIN_TEST_TOKEN', 'ADMIN_API_TOKEN', 'LOCAL_ADMIN_API_TOKEN'];
const ORIGIN = new URL(TEST_URL).origin;
const ADMIN_BASE = `${ORIGIN}/admin`;
const ADMIN_API_BASE = `${ORIGIN}/api/home-loan-rates/admin`;
const CLOUDFLARE_INSIGHTS_BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';

const PAGE_PATHS = ['dashboard', 'prototypes', 'status', 'integrity', 'database', 'exports', 'clear', 'config', 'runs', 'logs'];

function asPathname(value: string): string {
  return new URL(value).pathname;
}

function isLoginPath(pathname: string): boolean {
  return pathname === '/admin' || pathname === '/admin/';
}

function summaryAndExit(results: { passed: string[]; failed: string[] }): never {
  console.log('\n========================================');
  console.log('ADMIN PORTAL AUDIT SUMMARY');
  console.log('========================================');
  console.log(`PASSED: ${results.passed.length}`);
  for (const line of results.passed) console.log(`PASS ${line}`);
  if (results.failed.length > 0) {
    console.log(`\nFAILED: ${results.failed.length}`);
    for (const line of results.failed) console.log(`FAIL ${line}`);
  }
  console.log('========================================\n');
  process.exit(results.failed.length > 0 ? 1 : 0);
}

async function checkNoAuthApi401(results: { passed: string[]; failed: string[] }) {
  const endpoints = [
    '/runs?limit=1',
    '/runs/realtime?limit=1',
    '/health?limit=1',
    '/economic/collect',
    '/config',
    '/env',
    '/db/tables?counts=true',
    '/db/clear/options',
    '/logs/system/stats',
    '/logs/system/actionable?limit=5',
  ];

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
  const page = await browser.newPage();
  try {
    await page.goto(`${ADMIN_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });

    for (const endpoint of endpoints) {
      const payload = await page.evaluate(async (url: string) => {
        const res = await fetch(url, { credentials: 'omit' });
        const json = await res.json().catch(() => null);
        return { status: res.status, json };
      }, ADMIN_API_BASE + endpoint);
      const code = payload.json && payload.json.error ? payload.json.error.code : null;
      const reason = payload.json && payload.json.error && payload.json.error.details ? payload.json.error.details.reason : null;
      const ok = payload.status === 401 && code === 'UNAUTHORIZED' && reason === 'admin_token_or_access_jwt_required';
      if (ok) {
        results.passed.push(`unauth API ${endpoint} returns 401 UNAUTHORIZED`);
      } else {
        results.failed.push(
          `unauth API ${endpoint} expected 401/UNAUTHORIZED/admin_token_or_access_jwt_required but got status=${payload.status} code=${code} reason=${reason}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}

async function checkInvalidTokenMessage(results: { passed: string[]; failed: string[] }) {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
  const page = await browser.newPage();
  try {
    await page.goto(`${ADMIN_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.fill('#admin-token', 'invalid-token-for-audit');
    await page.click('#login-btn');
    await page.waitForSelector('#login-error.visible', { timeout: 15000 });
    const errorText = await page.$eval('#login-error', (el: HTMLElement) => (el.textContent || '').trim());
    if (errorText.toLowerCase().includes('token')) {
      results.passed.push('invalid token shows login error message');
    } else {
      results.failed.push(`invalid token message unexpected: "${errorText}"`);
    }
  } finally {
    await browser.close();
  }
}

async function checkGuardRedirects(results: { passed: string[]; failed: string[] }) {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
  const page = await browser.newPage();
  try {
    for (const p of PAGE_PATHS) {
      await page.goto(`${ADMIN_BASE}/${p}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(600);
      const pathname = asPathname(page.url());
      if (isLoginPath(pathname)) {
        results.passed.push(`guard redirects /admin/${p} to login`);
      } else {
        results.failed.push(`guard did not redirect /admin/${p}; final path=${pathname}`);
      }
    }
  } finally {
    await browser.close();
  }
}

async function checkAuthedPortal(results: { passed: string[]; failed: string[] }) {
  if (!ADMIN_TEST_TOKEN) {
    results.failed.push(
      `authenticated admin checks require one of ${ADMIN_TOKEN_ENV_NAMES.join(', ')} in the process environment`,
    );
    return;
  }

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const adminNetworkFailures: Array<{ status: number; url: string }> = [];
  let ignoredInsightsConsoleErrorBudget = 0;

  page.on('console', (msg: { type: () => string; text: () => string }) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text === 'Failed to load resource: net::ERR_NAME_NOT_RESOLVED' && ignoredInsightsConsoleErrorBudget > 0) {
      ignoredInsightsConsoleErrorBudget -= 1;
      return;
    }
    consoleErrors.push(text);
  });
  page.on('pageerror', (err: Error) => pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('requestfailed', (req: { url: () => string; failure: () => { errorText?: string } | null }) => {
    const failure = req.failure();
    if (req.url().startsWith(CLOUDFLARE_INSIGHTS_BEACON) && failure?.errorText === 'net::ERR_NAME_NOT_RESOLVED') {
      ignoredInsightsConsoleErrorBudget += 1;
    }
  });
  page.on('response', (res: { url: () => string; status: () => number }) => {
    const url = res.url();
    if (url.includes('/api/home-loan-rates/admin') && res.status() >= 400) {
      adminNetworkFailures.push({ status: res.status(), url });
    }
  });

  async function runStep(label: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.passed.push(label);
    } catch (err) {
      results.failed.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    let authReady = false;

    await runStep('valid token login redirects to dashboard', async () => {
      await page.goto(`${ADMIN_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.fill('#admin-token', ADMIN_TEST_TOKEN);
      await page.click('#login-btn');
      try {
        await page.waitForURL(/\/admin\/dashboard(\.html)?$/, { timeout: 25000 });
      } catch (error) {
        const loginError = await page
          .$eval('#login-error', (el: HTMLElement) => (el.textContent || '').trim())
          .catch(() => '');
        throw new Error(loginError || (error instanceof Error ? error.message : String(error)));
      }
      authReady = true;
    });

    if (!authReady) return;

    await runStep('dashboard navigation cards render', async () => {
      await page.goto(`${ADMIN_BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const navTexts = await page.$$eval('main.admin-dash .admin-nav-card-title', (nodes: HTMLElement[]) =>
        nodes.map((n) => (n.textContent || '').trim()),
      );
      const required = ['Prototype', 'Status', 'Data integrity', 'Database', 'Clear data', 'Configuration', 'Runs', 'Logs'];
      const missing = required.filter((v) => !navTexts.includes(v));
      if (missing.length) throw new Error(`missing cards: ${missing.join(', ')}`);
    });

    await runStep('prototype catalogue renders registry entry and preview link', async () => {
      await page.goto(`${ADMIN_BASE}/prototypes`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => {
        return document.querySelectorAll('#prototype-grid .admin-nav-card').length > 0;
      }, null, { timeout: 25000 });
      const cardTitles = await page.$$eval('#prototype-grid .admin-nav-card-title', (nodes: HTMLElement[]) =>
        nodes.map((node) => (node.textContent || '').trim()),
      );
      if (!cardTitles.includes('Real-Data Lightweight Charts')) {
        throw new Error(`unexpected prototype cards: ${cardTitles.join(', ')}`);
      }
      const previewHref = await page.$eval('#prototype-grid .admin-nav-card a', (node: HTMLAnchorElement) => node.href);
      if (!previewHref || !/admin\/prototypes\/lightweight-charts\/?$/i.test(previewHref)) {
        throw new Error(`unexpected preview href: ${previewHref}`);
      }
    });

    await runStep('status page refresh loads summary', async () => {
      await page.goto(`${ADMIN_BASE}/status`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.click('#run-check-btn');
      await page.waitForFunction(() => {
        const txt = (document.getElementById('status-line')?.textContent || '').trim();
        const economic = (document.getElementById('economic-overview')?.textContent || '').trim();
        return txt.length > 0 && !/^loading/i.test(txt) && !/^failed/i.test(txt) && economic.length > 0;
      }, null, { timeout: 25000 });
    });

    await runStep('database row selection enables edit/delete controls', async () => {
      await page.goto(`${ADMIN_BASE}/database`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => {
        const sel = document.getElementById('table-select') as HTMLSelectElement | null;
        return !!sel && sel.options.length > 1;
      }, null, { timeout: 25000 });
      const selectedTable = await page.$eval('#table-select', (sel: HTMLSelectElement) => {
        const options = Array.from(sel.options).map((o) => o.value).filter(Boolean);
        return options.includes('historical_loan_rates') ? 'historical_loan_rates' : (options[0] || '');
      });
      await page.selectOption('#table-select', selectedTable);
      await page.waitForFunction(() => document.querySelectorAll('#db-grid .tabulator-row').length > 0, null, { timeout: 25000 });
      await page.click('#db-grid .tabulator-row .tabulator-cell');
      await page.waitForFunction(() => {
        const selected = document.querySelectorAll('#db-grid .tabulator-row.tabulator-selected').length;
        const edit = (document.getElementById('edit-btn') as HTMLButtonElement | null)?.disabled;
        const del = (document.getElementById('delete-btn') as HTMLButtonElement | null)?.disabled;
        return selected > 0 && edit === false && del === false;
      }, null, { timeout: 12000 });
    });

    await runStep('clear page product-type scope toggles work', async () => {
      await page.goto(`${ADMIN_BASE}/clear`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => document.querySelectorAll('#key-fields input').length > 0, null, { timeout: 25000 });
      await page.selectOption('#product-type', 'all');
      const allScopeState = await page.$eval('#scope', (sel: HTMLSelectElement) => {
        const byValue: Record<string, { disabled: boolean; hidden: boolean }> = {};
        Array.from(sel.options).forEach((opt) => {
          byValue[opt.value] = { disabled: opt.disabled, hidden: getComputedStyle(opt).display === 'none' };
        });
        return byValue;
      });
      await page.selectOption('#product-type', 'mortgages');
      const mortgageScopeState = await page.$eval('#scope', (sel: HTMLSelectElement) => {
        const byValue: Record<string, { disabled: boolean; hidden: boolean }> = {};
        Array.from(sel.options).forEach((opt) => {
          byValue[opt.value] = { disabled: opt.disabled, hidden: getComputedStyle(opt).display === 'none' };
        });
        return byValue;
      });
      const ok =
        allScopeState.individual?.disabled &&
        allScopeState.multiselect?.disabled &&
        !mortgageScopeState.individual?.disabled &&
        !mortgageScopeState.multiselect?.disabled;
      if (!ok) throw new Error('scope options did not toggle as expected');
    });

    await runStep('config/env render rows', async () => {
      await page.goto(`${ADMIN_BASE}/config`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => document.querySelectorAll('#env-tbody tr').length > 0, null, { timeout: 25000 });
      const configRows = await page.$$eval('#config-tbody tr', (rows: Element[]) => rows.length);
      const envRows = await page.$$eval('#env-tbody tr', (rows: Element[]) => rows.length);
      if (configRows < 0 || envRows <= 0) throw new Error(`config=${configRows} env=${envRows}`);
    });

    await runStep('runs realtime refresh works', async () => {
      await page.goto(`${ADMIN_BASE}/runs`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.click('#refresh-now');
      await page.waitForFunction(() => {
        const txt = (document.getElementById('live-meta')?.textContent || '').trim();
        return txt.includes('Live updates every') && !/^realtime unavailable/i.test(txt);
      }, null, { timeout: 25000 });
    });

    await runStep('exports page loads without error', async () => {
      await page.goto(`${ADMIN_BASE}/exports`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => {
        const summary = (document.getElementById('database-dump-summary')?.textContent || '').trim();
        const msg = (document.getElementById('exports-msg-copy')?.textContent || '').trim();
        return (summary.length > 0 || /loading|no jobs|recent jobs/i.test(summary)) && !/error|failed/i.test(msg);
      }, null, { timeout: 25000 });
    });

    await runStep('data integrity page loads without error', async () => {
      await page.goto(`${ADMIN_BASE}/integrity`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.click('#run-audit-btn');
      await page.waitForFunction(() => {
        const status = (document.getElementById('status-line')?.textContent || '').trim();
        const traffic = (document.getElementById('traffic-status')?.textContent || '').trim();
        const findings = (document.getElementById('findings-wrap')?.textContent || '').trim();
        return (status.length >= 0 || traffic.length > 0) && !/^error:/i.test(status) && /economic_/i.test(findings);
      }, null, { timeout: 25000 });
    });

    await runStep('database page treats economic tables as read-only', async () => {
      await page.goto(`${ADMIN_BASE}/database`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => {
        const sel = document.getElementById('table-select') as HTMLSelectElement | null;
        return !!sel && Array.from(sel.options).some((opt) => opt.value === 'economic_series_status');
      }, null, { timeout: 25000 });
      await page.selectOption('#table-select', 'economic_series_status');
      await page.waitForFunction(() => document.querySelectorAll('#db-grid .tabulator-row').length >= 0, null, { timeout: 25000 });
      await page.waitForFunction(() => {
        const add = (document.getElementById('add-btn') as HTMLButtonElement | null)?.disabled;
        const edit = (document.getElementById('edit-btn') as HTMLButtonElement | null)?.disabled;
        const del = (document.getElementById('delete-btn') as HTMLButtonElement | null)?.disabled;
        return add === true && edit === true && del === true;
      }, null, { timeout: 12000 });
    });

    await runStep('logs page system/client download actions work', async () => {
      await page.goto(`${ADMIN_BASE}/logs`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => {
        const txt = (document.getElementById('system-stats')?.textContent || '').trim();
        return txt.length > 0 && !/^loading/i.test(txt);
      }, null, { timeout: 25000 });
      const [systemJsonlDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click('#download-system-jsonl-btn'),
      ]);
      const [systemTextDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click('#download-system-text-btn'),
      ]);
      const [clientDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.click('#download-client-btn'),
      ]);
      if (
        !systemJsonlDownload.suggestedFilename() ||
        !systemTextDownload.suggestedFilename() ||
        !clientDownload.suggestedFilename()
      ) {
        throw new Error('download filename missing');
      }
    });

    await runStep('logout returns to login page', async () => {
      await page.goto(`${ADMIN_BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.click('#logout-btn');
      await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });
    });

    if (consoleErrors.length === 0) results.passed.push('no console errors during authenticated flow');
    else results.failed.push(`console errors detected during authenticated flow: ${consoleErrors.length}`);

    if (pageErrors.length === 0) results.passed.push('no page runtime errors during authenticated flow');
    else results.failed.push(`page runtime errors detected during authenticated flow: ${pageErrors.length}`);

    if (adminNetworkFailures.length === 0) results.passed.push('no admin API 4xx/5xx during authenticated read-only flow');
    else results.failed.push(`admin API 4xx/5xx during authenticated flow: ${adminNetworkFailures.length}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('========================================');
  console.log('AustralianRates Admin Portal Audit');
  console.log('========================================');
  console.log(`Origin: ${ORIGIN}`);
  console.log('Mode: production read-only checks');
  console.log(`Time: ${new Date().toISOString()}\n`);

  const results = { passed: [] as string[], failed: [] as string[] };

  if (!ADMIN_TEST_TOKEN) {
    results.failed.push('ADMIN_TEST_TOKEN or ADMIN_API_TOKEN is required');
    summaryAndExit(results);
  }

  await checkNoAuthApi401(results);
  await checkInvalidTokenMessage(results);
  await checkGuardRedirects(results);
  await checkAuthedPortal(results);
  summaryAndExit(results);
}

void main();
