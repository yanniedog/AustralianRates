import { chromium } from 'playwright';

const TARGET = process.env.TEST_URL || 'https://www.australianrates.com/';

const ERROR_PATTERNS = [/\bundefined\b/i, /\bNaN\b/, /\berror\b/i, /\bfailed\b/i, /\bnull\b/i, /EXPLORER_TABLE_ABNORMALITY/i];

async function run(): Promise<void> {
  const consoleEntries: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; error: string }> = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    consoleEntries.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    failedRequests.push({ url: req.url(), error: failure ? failure.errorText : '' });
  });

  console.log('Loading', TARGET, '...');
  const response = await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (response && response.status() !== 200) {
    console.log('HTTP status:', response.status());
  }

  await page.waitForSelector('#main-content', { timeout: 10000 }).catch(() => {});

  console.log('Waiting for hero stats...');
  await page
    .waitForFunction(
      () => {
        const el = document.getElementById('stat-records');
        return el && !el.textContent?.includes('...');
      },
      { timeout: 15000 },
    )
    .catch(() => {});

  console.log('Waiting for Rate Explorer table and rows...');
  let tableReady = false;
  try {
    await page.waitForFunction(
      () => {
        const table = document.getElementById('rate-table');
        if (!table) return false;
        const rows = table.querySelectorAll('.tabulator-row');
        if (rows.length > 0) return true;
        const placeholder = table.querySelector('.tabulator-placeholder');
        return !!(placeholder && (placeholder.textContent || '').trim().length > 0);
      },
      { timeout: 35000 },
    );
    tableReady = true;
  } catch {
    console.log('Table rows did not appear within 35s.');
  }
  await page.waitForTimeout(2000);

  let tableErrors: Array<{ text: string; col: string | number | null }> = [];
  const cellScan = await page.evaluate(() => {
    const cells = document.querySelectorAll('#rate-table .tabulator-cell');
    const suspicious: Array<{ text: string; col: string | number | null }> = [];
    cells.forEach((cell) => {
      const text = (cell.textContent || '').trim();
      if (!text) return;
      const lower = text.toLowerCase();
      if (
        lower.includes('undefined') ||
        lower.includes('nan') ||
        lower.includes('error') ||
        lower.includes('failed') ||
        lower === 'null' ||
        lower.includes('explorer_table_abnormality')
      ) {
        suspicious.push({ text: text.slice(0, 120), col: cell.getAttribute('tabulator-field') || (cell as HTMLTableCellElement).cellIndex });
      }
    });
    return suspicious;
  });
  if (Array.isArray(cellScan) && cellScan.length > 0) tableErrors = cellScan;

  let clientLogErrors: Array<{ level: string; message: string }> = [];
  try {
    clientLogErrors = await page.evaluate(() => {
      if (typeof (window as any).getSessionLogEntries !== 'function') return [];
      return (window as any)
        .getSessionLogEntries()
        .filter((e: any) => e.level === 'error' || (e.message && e.message.includes('EXPLORER_TABLE_ABNORMALITY')))
        .map((e: any) => ({ level: e.level, message: e.message }));
    });
  } catch {}

  const counts = await page
    .evaluate(() => {
      const rows = document.querySelectorAll('#rate-table .tabulator-row');
      const placeholder = document.querySelector('#rate-table .tabulator-placeholder');
      return { rowCount: rows.length, placeholderText: placeholder ? (placeholder.textContent || '').trim() : '' };
    })
    .catch(() => ({ rowCount: 0, placeholderText: '' }));

  const tableRowCount = counts.rowCount || 0;
  const tablePlaceholderText = counts.placeholderText || '';
  let firstRowSample: Array<{ col: string; value: string }> = [];
  if (tableRowCount > 0) {
    firstRowSample = await page
      .evaluate(() => {
        const headers: string[] = [];
        document.querySelectorAll('#rate-table .tabulator-col-title').forEach((h) => headers.push((h.textContent || '').trim()));
        const cells = document.querySelectorAll('#rate-table .tabulator-row:first-child .tabulator-cell');
        const out: Array<{ col: string; value: string }> = [];
        cells.forEach((cell, i) => out.push({ col: headers[i] || 'col' + i, value: (cell.textContent || '').trim().slice(0, 80) }));
        return out;
      })
      .catch(() => []);
  }

  await browser.close();

  console.log('\n========== TABLE ERROR DETECTION REPORT ==========\n');
  let hasIssue = false;

  if (pageErrors.length > 0) {
    hasIssue = true;
    console.log('Page (runtime) errors:');
    pageErrors.forEach((m) => console.log('  -', m));
    console.log('');
  }

  const consoleErrors = consoleEntries.filter((e) => e.type === 'error');
  const ignorableConsoleErrors = consoleErrors.filter(
    (e) =>
      e.text &&
      (e.text.includes('ERR_NAME_NOT_RESOLVED') || /status of 404|ERR_ABORTED/i.test(e.text)),
  );
  if (consoleErrors.length > 0 && consoleErrors.length > ignorableConsoleErrors.length) {
    hasIssue = true;
    console.log(`Console errors (${consoleErrors.length}):`);
    consoleErrors.forEach((e) => console.log('  -', (e.text || '').slice(0, 200)));
    console.log('');
  } else if (ignorableConsoleErrors.length > 0) {
    console.log(
      `Console: ${ignorableConsoleErrors.length} telemetry/third-party error(s) (ERR_NAME_NOT_RESOLVED, 404, or ERR_ABORTED) - ignored.`,
    );
  }

  const abnormalityLogs = consoleEntries.filter((e) => e.text && e.text.includes('EXPLORER_TABLE_ABNORMALITY'));
  if (abnormalityLogs.length > 0) {
    hasIssue = true;
    console.log('EXPLORER_TABLE_ABNORMALITY in console:');
    abnormalityLogs.forEach((e) => console.log('  -', (e.text || '').slice(0, 300)));
    console.log('');
  }

  if (clientLogErrors.length > 0) {
    hasIssue = true;
    console.log('Client log errors (EXPLORER_TABLE_ABNORMALITY or error level):');
    clientLogErrors.forEach((e) => console.log('  -', e.message || e));
    console.log('');
  }

  if (tableErrors.length > 0) {
    hasIssue = true;
    console.log(`Suspicious cell values in table (${tableErrors.length}):`);
    tableErrors.forEach((c) => console.log('  -', c.text, '(col:', c.col, ')'));
    console.log('');
  }

  const relevantFailures = failedRequests.filter((f) => f.url.includes('australianrates.com') && f.url.includes('/api/'));
  console.log('Table row count:', tableRowCount);
  if (tablePlaceholderText) console.log('Table placeholder text:', tablePlaceholderText);

  if (firstRowSample.length > 0) {
    console.log('First row sample (visible columns):');
    firstRowSample.forEach((c) => console.log('  ', c.col + ':', c.value));
    const firstCol = firstRowSample[0] && firstRowSample[0].col;
    if (firstCol !== 'Found at') {
      hasIssue = true;
      console.log('FAIL: First column header should be "Found at", got:', JSON.stringify(firstCol));
    }
  }

  if (relevantFailures.length > 0) {
    const abortedOnly = relevantFailures.every((f) => f.error === 'net::ERR_ABORTED');
    if (abortedOnly && tableRowCount > 0) {
      console.log('Failed API requests: one or more requests aborted (often a duplicate request); table still has', tableRowCount, 'rows.');
    } else {
      hasIssue = true;
      console.log('Failed API requests:');
      relevantFailures.forEach((f) => console.log('  -', f.url, f.error));
      console.log('');
    }
  }

  if (!tableReady && tableRowCount > 0) {
    console.log('(Table has data; initial wait timed out but rows are present.)');
  }
  if (!hasIssue && tableRowCount > 0) console.log('(Table has data; no table-related errors.)');
  if (!hasIssue) console.log('No table-related errors detected.');
  console.log('========== END REPORT ==========\n');
  process.exit(hasIssue ? 1 : 0);
}

void run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
