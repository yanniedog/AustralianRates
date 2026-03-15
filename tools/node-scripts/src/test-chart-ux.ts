// @ts-nocheck
const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const testUrlObj = new URL(TEST_URL);
const baseOrigin = testUrlObj.origin;
const sharedParams = new URLSearchParams(testUrlObj.search || '');
const DESKTOP_VIEWPORT = { width: 1440, height: 1200 };
const MOBILE_VIEWPORT = { width: 390, height: 1100 };
const SECTIONS = [
    { name: 'Home loans', path: '/', apiBasePath: '/api/home-loan-rates' },
    { name: 'Savings', path: '/savings/', apiBasePath: '/api/savings-rates' },
    { name: 'Term deposits', path: '/term-deposits/', apiBasePath: '/api/term-deposit-rates' },
];
const VIEWS = ['lenders', 'market', 'surface', 'compare', 'distribution'];

function withSharedQuery(path, apiBasePath) {
    const params = new URLSearchParams(sharedParams.toString());
    if (apiBasePath && params.has('apiBase')) {
        const currentApiBase = params.get('apiBase');
        try {
            const parsedApiBase = new URL(String(currentApiBase || ''));
            parsedApiBase.pathname = apiBasePath;
            params.set('apiBase', parsedApiBase.toString());
        } catch (_) {
            // Keep the original override if it is malformed.
        }
    }
    const query = params.toString();
    return baseOrigin + path + (query ? ('?' + query) : '');
}

async function waitForExplorerReady(page) {
    await page.waitForFunction(() => {
        const table = document.getElementById('rate-table');
        if (!table) return false;
        if (table.querySelectorAll('.tabulator-row').length > 0) return true;
        const placeholder = table.querySelector('.tabulator-placeholder');
        return !!(placeholder && String(placeholder.textContent || '').trim().length > 0);
    }, null, { timeout: 45000 });
}

async function gotoSection(page, section) {
    await page.goto(withSharedQuery(section.path, section.apiBasePath), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    await page.waitForSelector('#main-content', { timeout: 15000 });
    await page.waitForTimeout(2500);
    await waitForExplorerReady(page).catch(() => null);
}

async function drawChart(page) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        await page.click('#draw-chart');
        try {
            await page.waitForFunction(() => {
                const output = document.getElementById('chart-output');
                if (!output) return false;
                const rendered = output.getAttribute('data-chart-engine') === 'echarts' || !!output.querySelector('canvas') || !!output.querySelector('svg');
                if (!rendered) return false;
                const status = String((document.getElementById('chart-status') || {}).textContent || '').trim().toLowerCase();
                return status.indexOf('err') === -1;
            }, undefined, { timeout: 120000 });
            await page.waitForTimeout(1200);
            return;
        } catch (error) {
            if (attempt === 2) {
                const snapshot = await page.evaluate(() => ({
                    rows: document.querySelectorAll('#rate-table .tabulator-row').length,
                    placeholder: String(document.querySelector('#rate-table .tabulator-placeholder')?.textContent || '').trim(),
                    status: String(document.getElementById('chart-status')?.textContent || '').trim(),
                    error: String(document.getElementById('chart-error')?.textContent || '').trim(),
                    summary: String(document.getElementById('chart-summary')?.textContent || '').trim(),
                    recentLogs: typeof window.getSessionLogEntries === 'function' ? window.getSessionLogEntries().slice(-10) : [],
                }));
                throw new Error(`chart did not become ready: ${JSON.stringify(snapshot)}`);
            }
            await waitForExplorerReady(page).catch(() => null);
            await page.waitForTimeout(1000);
        }
    }
}

async function switchViewWithoutRatesFetch(page, view) {
    let requestCount = 0;
    const handler = (request) => {
        if (String(request.url() || '').includes('/rates?')) requestCount += 1;
    };

    page.context().on('request', handler);
    try {
        await page.click(`[data-chart-view="${view}"]`);
        await page.waitForFunction((nextView) => {
            const output = document.getElementById('chart-output');
            const renderedView = output?.getAttribute('data-chart-render-view')
                || document.querySelector('[data-chart-view].is-active')?.getAttribute('data-chart-view')
                || '';
            return String(renderedView) === String(nextView || '');
        }, view, { timeout: 15000 });
        await page.waitForTimeout(800);
    } finally {
        page.context().off('request', handler);
    }

    return requestCount;
}

async function collectChartMetrics(page) {
    return await page.evaluate(() => {
        const selectors = [
            '.terminal-chart-surface',
            '#chart-output',
            '#chart-series-list',
            '#chart-point-details',
            '#chart-detail-output',
            '#chart-data-summary',
        ];
        const boxes = {};
        selectors.forEach((selector) => {
            const el = document.querySelector(selector);
            boxes[selector] = el ? {
                selector,
                clientWidth: el.clientWidth,
                scrollWidth: el.scrollWidth,
                clientHeight: el.clientHeight,
                scrollHeight: el.scrollHeight,
            } : null;
        });

        return {
            pageFits: document.documentElement.scrollWidth <= window.innerWidth,
            view: String(
                document.getElementById('chart-output')?.getAttribute('data-chart-render-view')
                || document.querySelector('[data-chart-view].is-active')?.getAttribute('data-chart-view')
                || ''
            ),
            status: String(document.getElementById('chart-status')?.textContent || '').trim(),
            guidance: String(document.getElementById('chart-guidance')?.textContent || '').trim(),
            summary: String(document.getElementById('chart-summary')?.textContent || '').trim(),
            note: String(document.getElementById('chart-series-note')?.textContent || '').trim(),
            outputEngine: String(document.getElementById('chart-output')?.getAttribute('data-chart-engine') || ''),
            outputCanvases: document.querySelectorAll('#chart-output canvas').length,
            detailCanvases: document.querySelectorAll('#chart-detail-output canvas').length,
            summaryLabelCells: Array.from(document.querySelectorAll('#chart-data-summary td')).every((cell) => cell.hasAttribute('data-label')),
            summaryRows: document.querySelectorAll('#chart-data-summary tbody tr').length,
            surface: boxes['.terminal-chart-surface'],
            output: boxes['#chart-output'],
            seriesList: boxes['#chart-series-list'],
            pointDetails: boxes['#chart-point-details'],
            detailOutput: boxes['#chart-detail-output'],
            dataSummary: boxes['#chart-data-summary'],
        };
    });
}

function assertFits(metrics, failures, label, key) {
    const box = metrics[key];
    if (!box) {
        failures.push(`${label}: missing ${key} container`);
        return;
    }
    if (box.scrollWidth > box.clientWidth + 1) {
        failures.push(`${label}: ${key} has horizontal overflow (${box.scrollWidth} > ${box.clientWidth})`);
    }
}

function verifyChartState(metrics, failures, label, expectedView) {
    if (metrics.view !== expectedView) failures.push(`${label}: expected ${expectedView} view, got ${metrics.view || 'none'}`);
    if (!metrics.status || /^ERR/i.test(metrics.status)) failures.push(`${label}: chart status is invalid (${metrics.status || 'missing'})`);
    if (!metrics.guidance) failures.push(`${label}: chart guidance is missing`);
    if (!metrics.summary || metrics.summary === 'WAIT') failures.push(`${label}: chart summary did not populate`);
    if ((metrics.outputEngine !== 'echarts') && metrics.outputCanvases === 0) failures.push(`${label}: chart canvas did not render`);
    assertFits(metrics, failures, label, 'surface');
    assertFits(metrics, failures, label, 'output');
    assertFits(metrics, failures, label, 'seriesList');
    assertFits(metrics, failures, label, 'pointDetails');
}

async function verifyHistoryPane(page, failures, label) {
    await page.click('#tab-history');
    await page.waitForTimeout(500);

    const historyState = await collectChartMetrics(page);
    if (historyState.detailCanvases === 0) failures.push(`${label}: history detail chart did not render`);
    if (historyState.summaryRows === 0) failures.push(`${label}: history summary table is empty`);
    if (!historyState.summaryLabelCells) failures.push(`${label}: history summary table is missing responsive data-label cells`);
    assertFits(historyState, failures, label, 'detailOutput');
    assertFits(historyState, failures, label, 'dataSummary');

    await page.click('#tab-explorer');
    await page.waitForTimeout(250);
}

async function verifyDesktopSection(page, section, failures) {
    await gotoSection(page, section);
    await drawChart(page);

    let metrics = await collectChartMetrics(page);
    verifyChartState(metrics, failures, `${section.name} lenders`, 'lenders');

    for (const view of VIEWS.slice(1)) {
        const requestCount = await switchViewWithoutRatesFetch(page, view);
        if (requestCount !== 0) failures.push(`${section.name} ${view}: switching views triggered ${requestCount} unexpected /rates requests`);
        metrics = await collectChartMetrics(page);
        verifyChartState(metrics, failures, `${section.name} ${view}`, view);
    }

    await verifyHistoryPane(page, failures, section.name);
}

async function verifyMobileSection(browser, section, failures) {
    const page = await browser.newPage({ viewport: MOBILE_VIEWPORT });
    try {
        await gotoSection(page, section);
        await drawChart(page);

        const metrics = await collectChartMetrics(page);
        if (!metrics.pageFits) failures.push(`${section.name} mobile: page has horizontal overflow`);
        verifyChartState(metrics, failures, `${section.name} mobile lenders`, 'lenders');

        const surfaceRequests = await switchViewWithoutRatesFetch(page, 'surface');
        if (surfaceRequests !== 0) failures.push(`${section.name} mobile surface: switching views triggered ${surfaceRequests} unexpected /rates requests`);
        const surfaceMetrics = await collectChartMetrics(page);
        if (!surfaceMetrics.pageFits) failures.push(`${section.name} mobile surface: page has horizontal overflow`);
        verifyChartState(surfaceMetrics, failures, `${section.name} mobile surface`, 'surface');
    } finally {
        await page.close();
    }
}

async function main() {
    const failures = [];
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });

    try {
        const desktopPage = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
        try {
            for (const section of SECTIONS) {
                await verifyDesktopSection(desktopPage, section, failures);
            }
        } finally {
            await desktopPage.close();
        }

        for (const section of SECTIONS) {
            await verifyMobileSection(browser, section, failures);
        }
    } finally {
        await browser.close();
    }

    if (failures.length > 0) {
        console.error('Chart UX test failures:');
        failures.forEach((failure) => console.error(`- ${failure}`));
        process.exit(1);
    }

    console.log(`PASS Chart UX checks for ${TEST_URL}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
