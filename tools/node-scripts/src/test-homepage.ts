// @ts-nocheck
const fs = require('fs');
const { chromium } = require('playwright');
const { ensureChartReady } = require('./lib/chart-playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const SCREENSHOT_DIR = './test-screenshots';
const testUrlObj = new URL(TEST_URL);
const baseOrigin = testUrlObj.origin;
const sharedParams = new URLSearchParams(testUrlObj.search || '');
const isProductionUrl = /^https:\/\/www\.australianrates\.com\/?/i.test(TEST_URL);
const INVALID_ROUTE_PATH = '/does-not-exist';
const CLARITY_PROJECT_ID = 'vt4vtenviy';
const CLARITY_SRC = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
/** Tight defaults; override via env if production is slow or flaky. */
const GOTO_TIMEOUT_MS = Number(process.env.TEST_GOTO_TIMEOUT_MS || 20000);
const SEL_TIMEOUT_MS = Number(process.env.TEST_SELECTOR_TIMEOUT_MS || 10000);
/** Longer wait only for hero vs /snapshot alignment (inline + deferred bundles). */
const HERO_SNAPSHOT_WAIT_MS = Number(process.env.TEST_HERO_SNAPSHOT_WAIT_MS || 45000);
const POST_NAV_SETTLE_MS = Number(process.env.TEST_POST_NAV_SETTLE_MS || 350);
const ACTION_TIMEOUT_MS = Number(process.env.TEST_ACTION_TIMEOUT_MS || 45000);
const EXPLORER_TABLE_TIMEOUT_MS = Number(process.env.TEST_EXPLORER_TABLE_TIMEOUT_MS || 16000);
const PIVOT_CHART_TIMEOUT_MS = Number(process.env.TEST_PIVOT_CHART_TIMEOUT_MS || 24000);
const FILTER_SCENARIO_OPEN_MS = Number(process.env.TEST_FILTER_SCENARIO_MS || 11000);
const FILTER_PADS_MS = Number(process.env.TEST_FILTER_PADS_MS || 14000);
/** Skip Savings + Term Deposits section loop (homepage still full). Local iteration only; CI/deploy should use full suite. */
const VALID_SUITES = new Set(['smoke', 'pivot', 'mobile', 'sections']);
const TEST_SUITE = (() => {
    const arg = process.argv.find((value) => String(value || '').startsWith('--suite='));
    const parsed = String(arg || '--suite=smoke').slice('--suite='.length).trim().toLowerCase();
    return VALID_SUITES.has(parsed) ? parsed : 'smoke';
})();
/** Parallel legal tabs (1–4). Lower if Cloudflare or local proxy throttles burst navigations. */
const LEGAL_PAGE_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.TEST_LEGAL_CONCURRENCY || 2)));
/** Node fetch for noscript HTML has no browser-style limits; cap wait to avoid indefinite hangs. */
const NOSCRIPT_FETCH_TIMEOUT_MS = Number(process.env.TEST_NOSCRIPT_FETCH_TIMEOUT_MS || 25000);
const REQUIRED_HEADERS = ['Found at', 'Headline Rate', 'Bank', 'Product Code', 'Rate Confirmed', 'URLs'];
const HOME_ONLY_HEADERS = ['Comparison Rate'];
const VIEWPORTS = [
    { width: 375, height: 667, name: 'mobile' },
    { width: 768, height: 1024, name: 'tablet' },
    { width: 1920, height: 1080, name: 'desktop' },
];
const SECTIONS = [
    { name: 'Home Loans', path: '/', apiBasePath: '/api/home-loan-rates', expectComparisonRate: true },
    { name: 'Savings', path: '/savings/', apiBasePath: '/api/savings-rates', expectComparisonRate: false },
    { name: 'Term Deposits', path: '/term-deposits/', apiBasePath: '/api/term-deposit-rates', expectComparisonRate: false },
];
const LEGAL_PAGES = [
    { name: 'About', path: '/about/', titleIncludes: 'About AustralianRates', bodyIncludes: 'Independent rate tracking.' },
    { name: 'Privacy', path: '/privacy/', titleIncludes: 'Privacy Policy', bodyIncludes: 'Privacy policy.' },
    { name: 'Terms', path: '/terms/', titleIncludes: 'Terms of Use', bodyIncludes: 'Terms of use.' },
    { name: 'Contact', path: '/contact/', titleIncludes: 'Contact AustralianRates', bodyIncludes: 'Get in touch.' },
];

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

function isIgnorableTelemetryFailure(failure) {
    if (!failure || !failure.url) return false;
    const url = String(failure.url);
    const error = String(failure.error || '');
    if (url.includes('static.cloudflareinsights.com/beacon.min.js') && error.includes('ERR_NAME_NOT_RESOLVED')) return true;
    if (url.includes('clarity.ms/') && /^net::ERR_|ERR_/.test(error)) return true;
    if (error.includes('ERR_ABORTED')) return true;
    if (/127\.0\.0\.1|localhost/i.test(url) && /\/ingest\//i.test(url)) return true;
    return false;
}

function createResults() {
    return {
        passed: [],
        failed: [],
        warnings: [],
    };
}

function pass(results, message) {
    results.passed.push(`PASS ${message}`);
}

function fail(results, message) {
    results.failed.push(`FAIL ${message}`);
}

function warn(results, message) {
    results.warnings.push(`WARN ${message}`);
}

/** Calendar-day distance for YYYY-MM-DD strings (UTC date parts, no TZ shift). */
function ymdUtcMs(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
    if (!m) return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ymdCalendarDaysApart(a, b) {
    const msA = ymdUtcMs(a);
    const msB = ymdUtcMs(b);
    if (!Number.isFinite(msA) || !Number.isFinite(msB)) return NaN;
    return Math.round((msB - msA) / 86400000);
}

async function closeWithTimeout(label, action, timeoutMs = 6000) {
    let timer;
    try {
        const outcome = await Promise.race([
            Promise.resolve()
                .then(() => action())
                .then(() => 'closed')
                .catch((error) => {
                    console.warn(`${label} close failed:`, error && error.message ? error.message : String(error));
                    return 'failed';
                }),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve('timed_out'), timeoutMs);
            }),
        ]);
        if (outcome === 'timed_out') {
            console.warn(`${label} close timed out after ${timeoutMs}ms; continuing to avoid hanging the test run.`);
        }
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function createPhaseLogger() {
    const t0 = Date.now();
    let prev = t0;
    const quiet = process.env.TEST_QUIET === '1';
    return async function phase(title) {
        if (quiet) return;
        const now = Date.now();
        const total = ((now - t0) / 1000).toFixed(1);
        const delta = ((now - prev) / 1000).toFixed(1);
        prev = now;
        console.log(`[test-homepage] +${total}s (Δ${delta}s) ${title}`);
    };
}

async function prefetchNoscriptEntries(specs) {
    return Promise.all(
        specs.map(async (spec) => {
            const { label, url, apiBasePath } = spec;
            try {
                const response = await fetch(url, {
                    redirect: 'follow',
                    signal: AbortSignal.timeout(NOSCRIPT_FETCH_TIMEOUT_MS),
                });
                const html = await response.text();
                return { label, apiBasePath, status: response.status, html, fetchError: null };
            } catch (error) {
                const name = error && error.name ? String(error.name) : '';
                const msg = error && error.message ? String(error.message) : String(error);
                const timedOut = name === 'TimeoutError' || /aborted|timeout/i.test(msg);
                return {
                    label,
                    apiBasePath,
                    status: 0,
                    html: '',
                    fetchError: timedOut ? `timed out after ${NOSCRIPT_FETCH_TIMEOUT_MS}ms` : msg,
                };
            }
        }),
    );
}

function verifyNoscriptEntry(entry, results) {
    const { label, apiBasePath } = entry;
    if (entry.fetchError) {
        const kind = /timed out/i.test(entry.fetchError) ? 'timed out' : 'errored';
        fail(results, `${label}: noscript fetch ${kind} (${entry.fetchError})`);
        return;
    }
    if (entry.status !== 200) {
        fail(results, `${label}: noscript HTML fetch failed (${entry.status})`);
        return;
    }
    const html = entry.html;
    const needles = [
        '<noscript',
        `${apiBasePath}/export.csv`,
        `${apiBasePath}/filters`,
        `${apiBasePath}/health`,
    ];
    const missing = needles.filter((needle) => html.indexOf(needle) === -1);
    if (missing.length === 0) pass(results, `${label}: noscript API fallback links exist`);
    else fail(results, `${label}: noscript fallback missing ${missing.join(', ')}`);
}

async function verifyNoscriptFromBatch(batchPromise, label, results) {
    const entries = await batchPromise;
    const entry = entries.find((e) => e.label === label);
    if (!entry) {
        fail(results, `${label}: noscript prefetch missing entry`);
        return;
    }
    verifyNoscriptEntry(entry, results);
}

async function gotoPublic(page, url) {
    const maxAttempts = Number(process.env.TEST_GOTO_RETRIES || 2);
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const navTimeout = attempt === 0 ? GOTO_TIMEOUT_MS : GOTO_TIMEOUT_MS + 15000;
            const waitUntil = attempt === 0 ? 'domcontentloaded' : 'load';
            const selTimeout = attempt === 0 ? SEL_TIMEOUT_MS : Math.round(SEL_TIMEOUT_MS * 1.75);
            await page.goto(url, { waitUntil, timeout: navTimeout });
            await page.waitForSelector('#main-content', { state: 'attached', timeout: selTimeout });
            await page.waitForSelector('.site-header .site-brand', { state: 'visible', timeout: selTimeout });
            await page.waitForTimeout(POST_NAV_SETTLE_MS);
            return;
        } catch (err) {
            lastErr = err;
            if (attempt + 1 >= maxAttempts) break;
            await page.waitForTimeout(500);
        }
    }
    throw lastErr;
}

/**
 * True when the public feature flag for the `All rates` tab is enabled on the
 * live site. Admin-controlled; default off hides the tab via CSS and then
 * explorer-panel tests cannot open the panel or wait for rows.
 */
async function isExplorerFeatureEnabled(page) {
    return await page
        .evaluate(() => {
            const tab = document.getElementById('tab-explorer');
            if (!tab) return false;
            const style = window.getComputedStyle(tab);
            return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .catch(() => false);
}

async function waitForExplorerTableReady(page, timeout = EXPLORER_TABLE_TIMEOUT_MS) {
    // Chart is the default tab; the table lives in a hidden panel until Table is selected.
    async function openExplorerPanel() {
        await page.locator('#tab-explorer').scrollIntoViewIfNeeded().catch(() => {});
        await page.locator('#tab-explorer').click({ timeout: SEL_TIMEOUT_MS }).catch(() => {});
        await page.waitForFunction(() => {
            const panel = document.getElementById('panel-explorer');
            return !!(panel && !panel.hidden);
        }, null, { timeout: SEL_TIMEOUT_MS }).catch(() => null);
    }

    const tableReady = () => {
        const table = document.getElementById('rate-table');
        if (!table) return false;
        if (table.querySelectorAll('.tabulator-row').length > 0) return true;
        const placeholder = table.querySelector('.tabulator-placeholder');
        return !!(placeholder && String(placeholder.textContent || '').trim().length > 0);
    };

    await openExplorerPanel();
    try {
        await page.waitForFunction(tableReady, null, { timeout });
    } catch {
        await openExplorerPanel();
        await page.waitForTimeout(400);
        await page.waitForFunction(tableReady, null, { timeout });
    }
}

async function pollScrollUntil(page, baselineY, wantMoreThan, minDelta, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const y = await page.evaluate(() => window.scrollY).catch(() => baselineY);
        if (wantMoreThan) {
            if (y > baselineY + minDelta) return y;
        } else if (y < baselineY - minDelta) {
            return y;
        }
        await page.waitForTimeout(45);
    }
    return page.evaluate(() => window.scrollY).catch(() => baselineY);
}

async function waitForMobileRailVisible(page, timeout = 12000) {
    const started = Date.now();
    while ((Date.now() - started) < timeout) {
        const visible = await page.evaluate(() => {
            const rail = document.getElementById('mobile-table-rail');
            return !!(rail && !rail.hidden);
        }).catch(() => false);
        if (visible) return true;
        await page.evaluate(() => {
            if (window.AR && window.AR.mobileTableNav && typeof window.AR.mobileTableNav.refresh === 'function') {
                window.AR.mobileTableNav.refresh();
            }
        }).catch(() => {});
        await page.waitForTimeout(250);
    }
    return false;
}

async function verifySkipLink(page, results, label) {
    const skip = page.locator('.skip-link');
    if (!(await skip.isVisible().catch(() => false))) {
        fail(results, `${label}: skip link not visible`);
        return;
    }
    await skip.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const mainFocused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'main-content').catch(() => false);
    if (mainFocused) pass(results, `${label}: skip link focuses #main-content`);
    else fail(results, `${label}: skip link did not focus #main-content`);
}

async function verifyHeader(page, results, label, expectedTitle) {
    const header = await page.evaluate(() => ({
        brand: String(document.querySelector('.site-header .site-brand')?.textContent || '').trim(),
        tagline: String(document.querySelector('.site-header .site-brand-tagline')?.textContent || '').trim(),
        title: String(document.querySelector('.site-header .site-header-title')?.textContent || '').trim(),
    }));

    if (header.brand === 'AustralianRates') pass(results, `${label}: header brand renders`);
    else fail(results, `${label}: header brand mismatch (${header.brand || 'missing'})`);

    if (header.tagline === expectedTitle && header.title === expectedTitle) {
        pass(results, `${label}: header context matches ${expectedTitle}`);
    } else {
        fail(results, `${label}: header context mismatch (tagline="${header.tagline}", title="${header.title}")`);
    }
}

const REMOVED_CLASSIC_CHART_LABELS = ['Leaders', 'Ladder', 'Curve', 'Slope', 'Movement', 'Compare', 'Distribution'];

async function verifyWorkspaceShell(page, results, label, sectionPath) {
    const pathKey = String(sectionPath || '/');
    const shell = await page.evaluate(() => ({
        marketTerminal: !!document.querySelector('.market-terminal'),
        introSteps: Array.from(document.querySelectorAll('.market-intro-step-index')).map((el) => String(el.textContent || '').trim()),
        introActions: Array.from(document.querySelectorAll('.market-intro-actions .buttonish')).map((el) => String(el.textContent || '').trim()).filter(Boolean),
        marketIntroTitle: String(document.querySelector('.market-intro-title')?.textContent || '').trim(),
        hasObjectStringLeak: String(document.body.textContent || '').indexOf('[object Object]') >= 0,
        chartViews: Array.from(document.querySelectorAll('[data-chart-view]')).map((el) => ({
            label: String(el.getAttribute('data-ui-label') || el.textContent || '').trim(),
            hasIcon: !!el.querySelector('.ar-icon'),
        })),
        tabs: Array.from(document.querySelectorAll('.tab-btn')).map((el) => ({
            id: el.id,
            label: String(el.getAttribute('data-ui-label') || el.textContent || '').trim(),
            active: el.classList.contains('active'),
            hasIcon: !!el.querySelector('.ar-icon'),
        })),
        controls: {
            summary: !!document.getElementById('chart-summary'),
            chartOutput: !!document.getElementById('chart-output'),
            seriesList: !!document.getElementById('chart-series-list'),
            refresh: !!document.getElementById('refresh-page-btn'),
        },
    }));

    if (shell.marketTerminal) pass(results, `${label}: market workspace renders`);
    else fail(results, `${label}: market workspace missing`);

    if (
        !shell.hasObjectStringLeak &&
        (
            shell.introSteps.join(',') === '01,02,03'
            || (shell.introActions.length >= 2 && shell.introActions.every((entry) => entry.length >= 4))
            || (shell.marketIntroTitle.length >= 4)
        )
    ) {
        pass(results, `${label}: hero workspace affordances render without object-string leakage`);
    } else {
        fail(
            results,
            `${label}: hero workspace affordances are malformed (${shell.introActions.join(', ') || shell.introSteps.join(', ') || shell.marketIntroTitle || 'missing'})`,
        );
    }

    const actualChartViews = shell.chartViews.map((view) => view.label);
    const hasRemoved = REMOVED_CLASSIC_CHART_LABELS.some((name) => actualChartViews.includes(name));
    if (pathKey === '/term-deposits/' || pathKey === '/term-deposits/index.html') {
        const need = ['Rate Report', 'Ribbon (time)', 'Term vs time'];
        const ok =
            need.every((name) => actualChartViews.includes(name)) &&
            shell.chartViews.length === 3 &&
            shell.chartViews.every((view) => view.hasIcon) &&
            !hasRemoved;
        if (ok) pass(results, `${label}: term deposit chart view controls (report + extras) render with icon labels`);
        else fail(results, `${label}: term deposit chart view controls mismatch (${actualChartViews.join(', ')})`);
    } else {
        if (shell.chartViews.length === 0 && !hasRemoved) {
            pass(results, `${label}: classic chart view chips omitted (single default report view)`);
        } else {
            fail(
                results,
                `${label}: expected no [data-chart-view] buttons for this section (${actualChartViews.join(', ') || 'empty'})`,
            );
        }
    }

    const actualTabs = shell.tabs.map((tab) => tab.label);
    const chartTabs = shell.tabs.filter((tab) => tab.id === 'tab-chart');
    const hiddenWorkspaceTabs = shell.tabs.filter((tab) => tab.id === 'tab-explorer' || tab.id === 'tab-pivot');
    if (chartTabs.length === 1 && hiddenWorkspaceTabs.length === 0 && shell.tabs.every((tab) => tab.hasIcon)) {
        pass(results, `${label}: workspace tabs match the chart-only public contract`);
    } else {
        fail(results, `${label}: workspace tabs mismatch (${actualTabs.join(', ')})`);
    }

    const activeChart = shell.tabs.find((tab) => tab.id === 'tab-chart' && tab.active);
    if (activeChart) pass(results, `${label}: chart tab is active on load`);
    else fail(results, `${label}: chart tab is not active on load`);

    if (Object.values(shell.controls).every(Boolean)) pass(results, `${label}: core controls are present`);
    else fail(results, `${label}: one or more core controls are missing`);
}

async function verifyClarityPresent(page, results, label) {
    const state = await page.evaluate((expectedSrc) => {
        const script = document.getElementById('ar-clarity-tag');
        return {
            hasApi: typeof window.clarity === 'function',
            scriptId: String(script?.id || ''),
            scriptSrc: String(script?.getAttribute('src') || script?.src || ''),
            matchingScripts: Array.from(document.scripts).filter((node) => {
                const src = String(node.getAttribute('src') || node.src || '');
                return src === expectedSrc;
            }).length,
        };
    }, CLARITY_SRC).catch(() => ({
        hasApi: false,
        scriptId: '',
        scriptSrc: '',
        matchingScripts: 0,
    }));

    if (state.hasApi && state.scriptId === 'ar-clarity-tag' && state.scriptSrc === CLARITY_SRC && state.matchingScripts === 1) {
        pass(results, `${label}: Clarity bootstrap is present with the enforced project id`);
    } else if (!isProductionUrl) {
        warn(results, `${label}: Clarity bootstrap is not enforced on local/non-production test URLs`);
    } else {
        fail(results, `${label}: Clarity bootstrap missing or incorrect (id="${state.scriptId}", src="${state.scriptSrc}", count=${state.matchingScripts})`);
    }
}

async function verifyHeroStats(page, results, label) {
    await page.waitForFunction(() => {
        const stats = Array.from(document.querySelectorAll('#hero-stats .terminal-stat'));
        if (stats.length < 3) return false;
        return stats.every((el) => {
            const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            return text.length > 0 && text.indexOf('...') === -1;
        });
    }, null, { timeout: 15000 }).catch(() => null);

    const stats = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#hero-stats .terminal-stat')).map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim());
    });
    if (stats.length >= 3 && stats.every((text) => text.length > 0 && text.indexOf('...') === -1)) {
        pass(results, `${label}: summary stats loaded`);
    } else {
        fail(results, `${label}: summary stats incomplete (${stats.join(' | ') || 'none'})`);
    }
}

/** Production: hero Updated must reflect snapshot filtersResolved.endDate (aligned with charts). */
async function verifyHeroUpdatedAlignsWithSnapshot(page, results, label, apiBasePath, pathname = '/') {
    const base = apiBasePath.replace(/\/?$/, '');
    const basePageUrl = withSharedQuery(pathname, apiBasePath);

    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            const sep = basePageUrl.includes('?') ? '&' : '?';
            const retryUrl = `${basePageUrl}${sep}e2e_snapshot_bust=${Date.now()}`;
            await gotoPublic(page, retryUrl);
        }

        const bust = `_=${Date.now()}`;
        const snapshotUrl = `${baseOrigin}${base}/snapshot?${bust}`;
        let endYmd = '';
        try {
            const res = await fetch(snapshotUrl, { headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } });
            const body = await res.json();
            const fr = body && body.ok && body.data && body.data.filtersResolved;
            endYmd = fr ? String(fr.endDate || fr.end_date || '').trim().slice(0, 10) : '';
        } catch (_) {
            endYmd = '';
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
            fail(results, `${label}: snapshot filtersResolved.endDate missing (${endYmd || 'empty'})`);
            return;
        }

        await page
            .waitForFunction(() => {
                const d =
                    window.AR && window.AR.snapshot && window.AR.snapshot.data && window.AR.snapshot.data.filtersResolved;
                if (!d) return false;
                const raw = String(d.endDate || d.end_date || '')
                    .trim()
                    .slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
                const shown = document.querySelector('#stat-updated strong');
                const t = shown ? String(shown.textContent || '').trim() : '';
                return t.length > 0 && t !== 'Unavailable';
            }, null, { timeout: HERO_SNAPSHOT_WAIT_MS })
            .catch(() => null);

        const state = await page.evaluate(() => {
            const d =
                window.AR && window.AR.snapshot && window.AR.snapshot.data && window.AR.snapshot.data.filtersResolved;
            const dom = document.querySelector('#stat-updated strong');
            return {
                fr: d ? String(d.endDate || d.end_date || '').trim().slice(0, 10) : '',
                text: dom ? String(dom.textContent || '').trim() : '',
            };
        });

        const apart = ymdCalendarDaysApart(state.fr, endYmd);
        const coherent =
            state.fr === endYmd || (Number.isFinite(apart) && Math.abs(apart) === 1 && /^\d{4}-\d{2}-\d{2}$/.test(state.fr));
        if (!coherent) {
            if (attempt === 0) continue;
            fail(results, `${label}: page filtersResolved.endDate (${state.fr || 'none'}) ≠ API (${endYmd}) after coherence reload`);
            return;
        }
        if (state.fr !== endYmd && Number.isFinite(apart) && Math.abs(apart) === 1) {
            warn(
                results,
                `${label}: filtersResolved.endDate differs by one calendar day (page=${state.fr} API=${endYmd}); tolerated at ingest window boundary.`,
            );
        }
        if (!state.text || state.text === 'Unavailable') {
            fail(results, `${label}: hero Updated text missing or unavailable`);
            return;
        }
        pass(results, `${label}: hero Updated aligns with snapshot filtersResolved.endDate`);
        return;
    }
}

async function verifyNoPrimaryMobileHostArtifacts(page, results, label) {
    const state = await page.evaluate(() => {
        const switchLinks = Array.from(document.querySelectorAll('a[href]')).map((el) => ({
            text: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
            href: String(el.getAttribute('href') || '').trim(),
        })).filter((link) => {
            return /^MOB$/i.test(link.text)
                || /^Mobile site$/i.test(link.text)
                || /(^|\/\/)m\.australianrates\.com/i.test(link.href);
        });
        const alternateLinks = Array.from(document.querySelectorAll('link[rel="alternate"][href]')).map((el) => String(el.getAttribute('href') || '').trim())
            .filter((href) => /(^|\/\/)m\.australianrates\.com/i.test(href));
        return {
            switchLinks,
            alternateLinks,
        };
    }).catch(() => ({
        switchLinks: [],
        alternateLinks: [],
    }));

    if (state.switchLinks.length === 0 && state.alternateLinks.length === 0) {
        pass(results, `${label}: primary host does not expose dead mobile-host links`);
    } else {
        const details = state.switchLinks.map((link) => `${link.text || 'link'} -> ${link.href}`).concat(state.alternateLinks);
        fail(results, `${label}: dead mobile-host links still exposed (${details.join(' | ')})`);
    }
}

function verifyHeaders(results, label, headers, expectComparisonRate) {
    const normalized = headers.map((header) => String(header).trim());
    const required = REQUIRED_HEADERS.slice();
    if (expectComparisonRate) required.push.apply(required, HOME_ONLY_HEADERS);

    const missing = required.filter((header) => !normalized.includes(header));
    if (missing.length === 0) pass(results, `${label}: table headers include the current public contract`);
    else fail(results, `${label}: missing table headers (${missing.join(', ')})`);
}

async function verifyExplorerTable(page, results, label, expectComparisonRate) {
    if (!(await isExplorerFeatureEnabled(page))) {
        pass(results, `${label}: explorer feature disabled (skipping table checks)`);
        return;
    }
    await waitForExplorerTableReady(page);
    const table = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('#rate-table .tabulator-col-title')).map((el) => String(el.textContent || '').trim());
        const rowCount = document.querySelectorAll('#rate-table .tabulator-row').length;
        const placeholder = String(document.querySelector('#rate-table .tabulator-placeholder')?.textContent || '').trim();
        return { headers, rowCount, placeholder };
    });

    if (table.rowCount > 0) pass(results, `${label}: explorer table loaded ${table.rowCount} rows`);
    else if (table.placeholder) warn(results, `${label}: explorer table rendered placeholder (${table.placeholder})`);
    else fail(results, `${label}: explorer table did not render rows or a placeholder`);

    verifyHeaders(results, label, table.headers, expectComparisonRate);
}

async function verifyStartupSettled(page, results, label) {
    await page.waitForFunction(() => {
        const workspace = document.getElementById('workspace-status');
        return !workspace || workspace.hidden;
    }, null, { timeout: 20000 }).catch(() => null);

    const state = await page.evaluate(() => ({
        liveStatus: String(document.getElementById('filter-live-status')?.textContent || '').trim(),
        workspaceHidden: !!document.getElementById('workspace-status')?.hidden,
        workspaceTitle: String(document.getElementById('workspace-status-title')?.textContent || '').trim(),
        workspaceMessage: String(document.getElementById('workspace-status-message')?.textContent || '').trim(),
    })).catch(() => ({
        liveStatus: '',
        workspaceHidden: false,
        workspaceTitle: '',
        workspaceMessage: '',
    }));

    if (state.workspaceHidden) {
        pass(results, `${label}: startup settles without a visible degraded state`);
    } else {
        fail(results, `${label}: startup did not settle cleanly (live="${state.liveStatus}", status="${state.workspaceTitle}", message="${state.workspaceMessage}")`);
    }
}

async function verifyDefaultUrlState(page, results, label) {
    const state = await page.evaluate(() => {
        const url = new URL(window.location.href);
        return {
            hasTab: url.searchParams.has('tab'),
            hasMode: url.searchParams.has('mode'),
            hasMinRate: url.searchParams.has('min_rate'),
            hasView: url.searchParams.has('view'),
            hash: url.hash,
        };
    }).catch(() => ({
        hasTab: true,
        hasMode: true,
        hasMinRate: true,
        hasView: true,
        hash: '#unexpected',
    }));

    if (!state.hasTab && !state.hasMode && !state.hasMinRate && !state.hasView && (!state.hash || state.hash === '#main-content')) {
        pass(results, `${label}: default workspace URL omits internal default state`);
    } else {
        fail(results, `${label}: default workspace URL is noisy (tab=${state.hasTab}, mode=${state.hasMode}, min_rate=${state.hasMinRate}, view=${state.hasView}, hash="${state.hash}")`);
    }
}

async function verifyBankBadgeLogos(page, results, label) {
    await page.waitForFunction(() => {
        const logos = Array.from(document.querySelectorAll('#rate-table img.bank-badge-logo')).slice(0, 8);
        return logos.length >= 4 && logos.every((img) => img.complete && img.naturalWidth > 0 && String(img.getAttribute('loading') || '').toLowerCase() !== 'lazy');
    }, null, { timeout: 15000 }).catch(() => null);

    const logos = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#rate-table img.bank-badge-logo')).slice(0, 8).map((img) => ({
            complete: !!img.complete,
            loading: String(img.getAttribute('loading') || '').toLowerCase(),
            naturalWidth: Number(img.naturalWidth || 0),
        }));
    }).catch(() => []);

    const stable = logos.length >= 4 && logos.every((logo) => logo.complete && logo.naturalWidth > 0 && logo.loading !== 'lazy');
    if (stable) pass(results, `${label}: visible bank logos render eagerly without broken-image states`);
    else fail(results, `${label}: bank logo badges are incomplete or still lazy-loaded`);
}

async function verifyDesktopWorkspaceControls(page, results, label, baseUrl) {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoPublic(page, baseUrl);
    await waitForExplorerTableReady(page);

    async function dragRail(selector, cssVar, delta, controlLabel) {
        await page.locator(selector).scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(150);
        const before = await page.evaluate((payload) => {
            const handle = document.querySelector(payload.selector);
            const terminal = document.querySelector('.market-terminal');
            const header = document.querySelector('.site-header');
            if (!handle || !terminal) return null;
            const rect = handle.getBoundingClientRect();
            const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
            const x = rect.left + (rect.width / 2);
            const y = Math.max(headerBottom + 24, Math.min(window.innerHeight - 40, Math.max(rect.top + 40, 200)));
            const target = document.elementFromPoint(x, y);
            return {
                probeTargetId: target ? String(target.id || '') : '',
                value: getComputedStyle(terminal).getPropertyValue(payload.cssVar).trim(),
                x,
                y,
            };
        }, { selector, cssVar }).catch(() => null);

        if (!before || before.probeTargetId !== selector.replace(/^#/, '')) {
            fail(results, `${label}: ${controlLabel} could not be targeted for drag verification`);
            return;
        }

        await page.mouse.move(before.x, before.y);
        await page.mouse.down();
        await page.mouse.move(before.x + delta, before.y, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);

        const after = await page.evaluate((varName) => {
            const terminal = document.querySelector('.market-terminal');
            return terminal ? getComputedStyle(terminal).getPropertyValue(varName).trim() : '';
        }, cssVar).catch(() => '');

        if (after && after !== before.value) pass(results, `${label}: ${controlLabel} drag updates panel width`);
        else fail(results, `${label}: ${controlLabel} drag did not change the panel width`);
    }

    const hasRailResizers = await page.evaluate(() => !!(document.getElementById('left-rail-resizer') && document.getElementById('right-rail-resizer')));
    if (hasRailResizers) {
        await dragRail('#left-rail-resizer', '--ar-left-rail-width', 60, 'left rail resizer');
        await dragRail('#right-rail-resizer', '--ar-right-rail-width', -60, 'right rail resizer');
    } else {
        pass(results, `${label}: rail resizers skipped (single-column public layout)`);
    }

    await page.evaluate(() => {
        const d = document.getElementById('table-details');
        if (d && d.tagName === 'DETAILS') d.open = true;
    });
    await page.waitForTimeout(400);

    await page.locator('#rate-table').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForSelector('#panel-explorer:not([hidden])', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => {
        const btn = document.getElementById('table-settings-btn');
        if (btn) btn.click();
    });
    await page.evaluate(() => {
        const inp = document.querySelector('#table-settings-popover input[data-setting="move-columns"]');
        if (!inp) return;
        inp.checked = true;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const moveModeState = await page.evaluate(() => {
        const columns = document.querySelectorAll('#rate-table .tabulator-header .tabulator-col').length;
        const customTitles = Array.from(document.querySelectorAll('#rate-table .ar-move-col-title')).slice(0, 4).map((el) => {
            const rect = el.getBoundingClientRect();
            return {
                text: String(el.textContent || '').trim(),
                width: Number(rect.width || 0),
            };
        });
        return {
            columns,
            customCount: document.querySelectorAll('#rate-table .ar-move-col-title').length,
            tabulatorTitleCount: document.querySelectorAll('#rate-table .tabulator-header .tabulator-col .tabulator-col-title').length,
            customTitles,
        };
    }).catch(() => null);

    const moveModeLabelsVisible = !!moveModeState
        && moveModeState.customCount === moveModeState.columns
        && moveModeState.tabulatorTitleCount === moveModeState.columns
        && moveModeState.customTitles.length >= 4
        && moveModeState.customTitles.every((title) => title.text.length > 0 && title.width >= 16);

    if (moveModeLabelsVisible) pass(results, `${label}: move-column mode keeps a single visible label per header`);
    else fail(results, `${label}: move-column mode header labels are duplicated or collapsed`);

    const orderBefore = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#rate-table .ar-move-col-title')).slice(0, 4).map((el) => String(el.textContent || '').trim());
    }).catch(() => []);

    await page.evaluate(() => {
        const btn = document.querySelector('#rate-table .ar-move-col-btn-right');
        if (btn) btn.click();
    }).catch(() => {});
    await page.waitForTimeout(400);

    const orderAfter = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#rate-table .ar-move-col-title')).slice(0, 4).map((el) => String(el.textContent || '').trim());
    }).catch(() => []);

    const moved = orderBefore.length >= 2
        && orderAfter.length >= 2
        && orderAfter[0] === orderBefore[1]
        && orderAfter[1] === orderBefore[0];

    if (moved) pass(results, `${label}: move-column controls reorder the leading headers`);
    else fail(results, `${label}: move-column controls did not reorder the leading headers`);

    await page.evaluate(() => {
        try { window.localStorage.removeItem('ar-layout-widths:home-loans'); } catch (_) {}
    }).catch(() => {});
    await gotoPublic(page, baseUrl);
    await waitForExplorerTableReady(page);
}

async function verifyPublicFooter(page, results, label) {
    const footer = await page.evaluate(() => {
        return {
            links: Array.from(document.querySelectorAll('.site-footer-meta a[href]')).map((el) => ({
                text: String(el.textContent || '').trim(),
                href: String(el.getAttribute('href') || '').trim(),
            })),
            note: String(document.querySelector('.site-footer .footer-note')?.textContent || '').trim(),
            hasTechnical: !!document.getElementById('footer-technical'),
            hasLogLink: !!document.getElementById('footer-log-link'),
        };
    }).catch(() => ({
        links: [],
        note: '',
        hasTechnical: true,
        hasLogLink: true,
    }));

    const expected = [
        { text: 'About', href: '/about/' },
        { text: 'GitHub', href: 'https://github.com/yanniedog/AustralianRates' },
        { text: 'Donate', href: '#donate' },
        { text: 'Contact', href: '/contact/' },
        { text: 'Privacy', href: '/privacy/' },
        { text: 'Terms', href: '/terms/' },
    ];
    const missing = expected.filter((item) => !footer.links.some((link) => link.text === item.text && link.href === item.href));

    if (missing.length === 0) pass(results, `${label}: footer legal and project links render`);
    else fail(results, `${label}: missing footer links (${missing.map((item) => item.text).join(', ')})`);

    if (!footer.hasTechnical && !footer.hasLogLink) {
        pass(results, `${label}: public footer keeps technical diagnostics hidden`);
    } else {
        fail(results, `${label}: public footer leaked technical diagnostics`);
    }

    if (/confirm rates, fees, and eligibility/i.test(footer.note)) {
        pass(results, `${label}: public footer keeps a user-facing guidance note`);
    } else {
        fail(results, `${label}: public footer guidance note is missing`);
    }
}

async function verifyDonateModal(page, results, label) {
    const donate = page.locator('#site-footer-donate');
    const count = await donate.count().catch(() => 0);
    if (count === 0) {
        fail(results, `${label}: footer Donate control missing`);
        return;
    }
    await donate.click();
    const titleText = await page.locator('#site-donate-title').textContent().catch(() => '');
    if (/fuel the development/i.test(String(titleText || ''))) {
        pass(results, `${label}: donate modal opens with fuel-the-development title`);
    } else {
        fail(results, `${label}: donate modal title missing or wrong`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
}

async function verifyPublicHeaderRefresh(page, results, label) {
    const btn = page.locator('#refresh-site-btn');
    const count = await btn.count().catch(() => 0);
    if (count === 0) {
        fail(results, `${label}: header Refresh control missing`);
        return;
    }
    const visible = await btn.first().isVisible().catch(() => false);
    if (visible) pass(results, `${label}: header Refresh control is visible`);
    else fail(results, `${label}: header Refresh control not visible`);
}

async function verifyExplorerHeading(page, results, label) {
    const state = await page.evaluate(() => ({
        heading: String(document.querySelector('.market-intro-title')?.textContent || '').trim(),
        explorerTitle: String(document.getElementById('explorer-overview-title')?.textContent || '').trim(),
    })).catch(() => ({
        heading: '',
        explorerTitle: '',
    }));

    if (state.heading.length >= 20) pass(results, `${label}: hero heading is descriptive`);
    else fail(results, `${label}: hero heading is too thin`);

    if (!state.explorerTitle) {
        pass(results, `${label}: table overview removed from the public site`);
    } else if (/[A-Za-z]/.test(state.explorerTitle) && !/^\d[\d,]*(\/\d[\d,]*)?$/.test(state.explorerTitle)) {
        pass(results, `${label}: table overview heading stays descriptive`);
    } else {
        fail(results, `${label}: table overview heading degraded to numeric shorthand`);
    }
}

async function verifyLegalMenuSimplified(page, results, label) {
    const toggle = page.locator('#site-menu-toggle');
    if (!(await toggle.isVisible().catch(() => false))) {
        fail(results, `${label}: legal menu toggle missing`);
        return;
    }

    await toggle.click();
    await page.waitForTimeout(250);

    const payload = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#site-menu-drawer a[href]')).map((el) => String(el.getAttribute('href') || '').trim());
    }).catch(() => []);

    const expected = ['/', '/savings/', '/term-deposits/', '/economic-data/', '/about/', '/contact/', '/privacy/', '/terms/'];
    const missing = expected.filter((href) => !payload.includes(href));
    const extras = payload.filter((href) => expected.indexOf(href) === -1);
    const hasHashes = payload.some((href) => href.indexOf('#') >= 0);

    if (missing.length === 0 && extras.length === 0 && !hasHashes) {
        pass(results, `${label}: legal menu stays focused on top-level sections`);
    } else {
        fail(results, `${label}: legal menu still exposes workspace-deep links`);
    }

    await page.keyboard.press('Escape').catch(() => {});
}

async function verifyClientLog(page, results, label, minCount = 10) {
    await page.waitForFunction((threshold) => {
        return typeof window.getSessionLogEntries === 'function' && window.getSessionLogEntries().length >= threshold;
    }, minCount, { timeout: 15000 }).catch(() => null);

    const payload = await page.evaluate(() => {
        const entries = typeof window.getSessionLogEntries === 'function' ? window.getSessionLogEntries() : [];
        return {
            count: entries.length,
            messages: entries.map((entry) => String(entry.message || '')),
        };
    }).catch(() => ({ count: 0, messages: [] }));

    const hasLifecycleSignal = payload.messages.some((message) => {
        return /App init|Filter|Hero stats|Commit info|Tab activated|Chart|Explorer/i.test(message);
    });

    if (payload.count >= minCount && hasLifecycleSignal) {
        pass(results, `${label}: client log is populated with lifecycle events`);
    } else {
        fail(results, `${label}: client log is too thin (${payload.count} entries)`);
    }
}

async function verifyNoPublicAdminSurface(page, results, label) {
    const adminLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
            .map((el) => String(el.getAttribute('href') || '').trim())
            .filter((href) => href.indexOf('/admin') >= 0 || href === 'admin/' || href === '../admin/');
    }).catch(() => []);

    if (adminLinks.length === 0) pass(results, `${label}: no discoverable public admin links`);
    else fail(results, `${label}: public admin links leaked (${adminLinks.join(', ')})`);
}

async function verifyPublicTriggerRemoval(page, results, label) {
    const count = await page.locator('#trigger-run').count().catch(() => 0);
    if (count === 0) pass(results, `${label}: public trigger controls remain removed`);
    else fail(results, `${label}: public trigger control leaked back in`);
}

async function verifyChartSmoke(page, results, label) {
    // Prior steps may leave the Table tab active; chart panel hidden can confuse hit-testing for workspace actions.
    const tabChart = page.locator('#tab-chart');
    await tabChart.scrollIntoViewIfNeeded().catch(() => {});
    await tabChart.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(250);

    await ensureChartReady(page);

    const chart = await page.evaluate(() => {
        const out = document.getElementById('chart-output');
        const status = String(document.getElementById('chart-status')?.textContent || '').trim();
        const st = status.toLowerCase();
        const hasEmpty = !!(out && out.querySelector('.chart-output-empty'));
        const emptyTerminal =
            hasEmpty &&
            /^(no data|no curve data|no time ribbon data|no term vs time data|no lender match|no slope data|no ladder data|no distribution data|no numeric values)$/.test(
                st,
            );
        return {
            engine: String(out?.getAttribute('data-chart-engine') || ''),
            dataRendered: out?.getAttribute('data-chart-rendered') === 'true',
            canvases: document.querySelectorAll('#chart-output canvas').length,
            svgs: document.querySelectorAll('#chart-output svg').length,
            status,
            summary: String(document.getElementById('chart-summary')?.textContent || '').trim(),
            emptyTerminal,
        };
    });

    // Keep in sync with waitForChartReady: SVG / data-chart-rendered count as rendered even if status is briefly empty.
    const hasVisualChart =
        chart.engine === 'echarts' ||
        chart.engine === 'lightweight' ||
        chart.dataRendered ||
        chart.canvases > 0 ||
        chart.svgs > 0;
    const chartDrawn = chart.emptyTerminal || hasVisualChart;
    if (chartDrawn) {
        pass(results, `${label}: chart view renders live output`);
    } else {
        fail(results, `${label}: chart draw did not render`);
    }

    if (chart.summary && chart.summary !== 'WAIT') pass(results, `${label}: chart summary updates after draw`);
    else fail(results, `${label}: chart summary did not populate after draw`);
}

async function isPivotWorkspaceAvailable(page) {
    return await page.evaluate(() => {
        return !!(document.getElementById('tab-pivot') && document.getElementById('panel-pivot') && document.getElementById('load-pivot'));
    }).catch(() => false);
}

async function verifyPivotLoad(page, results, label) {
    const pivotAvailable = await isPivotWorkspaceAvailable(page);
    if (!pivotAvailable) {
        pass(results, `${label}: pivot workspace removed from the public site`);
        return;
    }
    await page.evaluate(() => {
        const d = document.getElementById('table-details');
        if (d && d.tagName === 'DETAILS') d.open = true;
    });
    await page.waitForTimeout(400);
    const pivotVisible = await page.evaluate(() => {
        const panel = document.getElementById('panel-pivot');
        return !!(panel && !panel.hidden && panel.classList.contains('active'));
    }).catch(() => false);

    if (!pivotVisible) {
        const tabPivot = page.locator('#tab-pivot');
        await tabPivot.scrollIntoViewIfNeeded().catch(() => {});
        await tabPivot.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        await tabPivot.click({ force: true, timeout: 15000 });
        await page.waitForTimeout(300);
    }
    const pivotVisibleAfterClick = await page.evaluate(() => {
        const panel = document.getElementById('panel-pivot');
        return !!(panel && !panel.hidden && panel.classList.contains('active'));
    }).catch(() => false);
    if (!pivotVisibleAfterClick) {
        fail(results, `${label}: pivot tab did not activate`);
        return;
    }

    const loadPivotBtn = page.locator('#load-pivot');
    const readPivotState = () => page.evaluate(() => ({
        status: String(document.getElementById('pivot-status')?.textContent || '').trim(),
        hasUi: !!document.querySelector('#pivot-output .pvtUi'),
    })).catch(() => ({ status: '', hasUi: false }));

    async function waitForPivotUi(timeoutMs) {
        await page.waitForFunction(() => !!document.querySelector('#pivot-output .pvtUi'), null, { timeout: timeoutMs }).catch(() => null);
    }

    await loadPivotBtn.click({ force: true });
    await waitForPivotUi(PIVOT_CHART_TIMEOUT_MS);
    let pivotReady = await readPivotState();

    if (!(pivotReady.hasUi && /loaded/i.test(pivotReady.status))) {
        await page.waitForTimeout(500);
        await loadPivotBtn.click({ force: true });
        await waitForPivotUi(Math.max(12000, Math.floor(PIVOT_CHART_TIMEOUT_MS / 2)));
        pivotReady = await readPivotState();
    }

    if (pivotReady.hasUi && /loaded/i.test(pivotReady.status)) {
        pass(results, `${label}: pivot workspace loads rows`);
    } else {
        fail(results, `${label}: pivot workspace did not load`);
    }
}

async function verifyExportDownload(page, results, label) {
    const hasDropdown = await page.locator('#download-format').count().then((n) => n > 0).catch(() => false);
    if (!hasDropdown) {
        pass(results, `${label}: public export controls are removed (admin-only)`);
    } else {
        fail(results, `${label}: public export controls should be removed`);
    }
}

async function verifyCopyLinkFeedback(page, results, label) {
    const copyLink = page.locator('#workspace-copy-link');
    if (!(await copyLink.isVisible().catch(() => false))) {
        pass(results, `${label}: public workspace omits the legacy copy-link trigger`);
        return;
    }

    await page.click('#workspace-copy-link');
    await page.waitForFunction(() => {
        const status = document.getElementById('workspace-copy-status');
        return !!(status && !status.hidden && /copied/i.test(String(status.textContent || '')));
    }, null, { timeout: 15000 }).catch(() => null);

    const payload = await page.evaluate(() => {
        const entries = typeof window.getSessionLogEntries === 'function' ? window.getSessionLogEntries() : [];
        return {
            statusText: String(document.getElementById('workspace-copy-status')?.textContent || '').trim(),
            statusHidden: !!document.getElementById('workspace-copy-status')?.hidden,
            buttonText: String(document.querySelector('#workspace-copy-link .ar-icon-label-text')?.textContent || document.getElementById('workspace-copy-link')?.textContent || '').replace(/\s+/g, ' ').trim(),
            messages: entries.map((entry) => String(entry.message || '')),
        };
    }).catch(() => ({
        statusText: '',
        statusHidden: true,
        buttonText: '',
        messages: [],
    }));

    if (!payload.statusHidden && /copied/i.test(payload.statusText)) {
        pass(results, `${label}: copy-link action confirms success in the UI`);
    } else {
        fail(results, `${label}: copy-link action did not expose a visible success status`);
    }

    if (payload.messages.includes('Workspace link copied')) {
        pass(results, `${label}: copy-link action is reflected in the client log`);
    } else {
        fail(results, `${label}: copy-link action did not reach the client log`);
    }

    await page.waitForFunction(() => {
        const t = String(document.querySelector('#workspace-copy-link .ar-icon-label-text')?.textContent
            || document.getElementById('workspace-copy-link')?.textContent || '').replace(/\s+/g, ' ').trim();
        return /^link$/i.test(t);
    }, null, { timeout: 4000 }).catch(() => null);
    const restored = await page.evaluate(() => {
        return String(document.querySelector('#workspace-copy-link .ar-icon-label-text')?.textContent || document.getElementById('workspace-copy-link')?.textContent || '').replace(/\s+/g, ' ').trim();
    }).catch(() => '');

    if (/^link$/i.test(restored)) pass(results, `${label}: copy-link button resets its label after confirmation`);
    else fail(results, `${label}: copy-link button did not reset after confirmation`);
}

async function verifyFilterAccessibleNames(page, results, label) {
    await page.evaluate(() => {
        const slice = document.getElementById('scenario');
        if (slice && slice.tagName === 'DETAILS') slice.open = true;
    });
    await page.waitForSelector('#scenario[open]', { timeout: FILTER_SCENARIO_OPEN_MS });
    await page.waitForSelector('#filter-bank-search', { state: 'visible', timeout: SEL_TIMEOUT_MS });
    await page.waitForSelector('#filter-security-pads .filter-pad-btn', { timeout: FILTER_PADS_MS });

    const checks = [
        { name: 'bank search', locator: page.locator('#filter-bank-search'), reject: 'All All' },
        { name: 'purpose filter', locator: page.locator('#filter-security-pads button').first(), reject: 'Purpose Purpose' },
        { name: 'repayment filter', locator: page.locator('#filter-repayment-pads button').first(), reject: 'Repayment Repayment' },
        { name: 'structure filter', locator: page.locator('#filter-structure-pads button').first(), reject: 'Structure Structure' },
        { name: 'LVR filter', locator: page.locator('#filter-lvr-pads button').first(), reject: 'LVR band LVR band' },
        { name: 'features filter', locator: page.locator('#filter-feature-pads button').first(), reject: 'Features Features' },
    ];

    for (const check of checks) {
        const snapshot = await check.locator.evaluate((el) => {
            if (!el) return '';
            var al = el.getAttribute('aria-label') || '';
            var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            return [al, text].filter(Boolean).join(' | ');
        }).catch(() => '');
        if (snapshot && snapshot.indexOf(check.reject) === -1) pass(results, `${label}: ${check.name} keeps a concise accessible name`);
        else fail(results, `${label}: ${check.name} accessible name is noisy (${snapshot || 'missing'})`);
    }
}

async function verifyTabsAndHash(page, results, label, baseUrl) {
    const chartOnly = await page.evaluate(() => {
        return {
            chart: !!document.getElementById('tab-chart'),
            explorer: !!document.getElementById('tab-explorer'),
            pivot: !!document.getElementById('tab-pivot'),
        };
    }).catch(() => ({ chart: false, explorer: false, pivot: false }));

    if (chartOnly.chart && !chartOnly.explorer && !chartOnly.pivot) {
        const state = await page.evaluate(() => {
            const panel = document.querySelector('#panel-chart');
            const button = document.getElementById('tab-chart');
            return {
                panelActive: !!(panel && !panel.hidden && panel.classList.contains('active')),
                buttonActive: !!(button && button.classList.contains('active')),
                hash: window.location.hash,
            };
        }).catch(() => ({ panelActive: false, buttonActive: false, hash: '' }));
        const hashOk = state.hash === '' || state.hash === '#chart' || state.hash === '#main-content';
        if (state.panelActive && state.buttonActive && hashOk) pass(results, `${label}: chart tab remains the only public workspace tab`);
        else fail(results, `${label}: chart-only workspace tab state is invalid`);

        await gotoPublic(page, baseUrl + '#chart');
        const restoredChart = await page.evaluate(() => {
            const chart = document.getElementById('panel-chart');
            const button = document.getElementById('tab-chart');
            return !!(chart && !chart.hidden && chart.classList.contains('active') && button && button.classList.contains('active'));
        }).catch(() => false);

        if (restoredChart) pass(results, `${label}: #chart deep link restores the chart tab`);
        else fail(results, `${label}: #chart deep link did not restore the chart tab`);
        return;
    }
    // Public workspace exposes Chart, Table (explorer), and Pivot only — no history/changes tabs.
    const scenarios = [
        { tabId: '#tab-pivot', panelId: '#panel-pivot', hash: '#pivot', name: 'pivot' },
        { tabId: '#tab-explorer', panelId: '#panel-explorer', hash: '', name: 'explorer' },
        { tabId: '#tab-chart', panelId: '#panel-chart', hash: '', name: 'chart' },
    ];

    for (const scenario of scenarios) {
        const tabLocator = page.locator(scenario.tabId);
        await tabLocator.scrollIntoViewIfNeeded().catch(() => {});
        await tabLocator.click({ timeout: 15000 });
        await page.waitForTimeout(250);
        const state = await page.evaluate((panelId) => {
            const panel = document.querySelector(panelId);
            return !!(panel && !panel.hidden && panel.classList.contains('active'));
        }, scenario.panelId).catch(() => false);
        const currentHash = new URL(page.url()).hash;
        const hashOk = scenario.hash === ''
            ? (currentHash === '' || currentHash === '#main-content')
            : currentHash === scenario.hash;

        if (state && hashOk) pass(results, `${label}: ${scenario.name} tab updates the active panel and URL hash`);
        else fail(results, `${label}: ${scenario.name} tab/hash sync failed`);
    }

    await gotoPublic(page, baseUrl + '#pivot');
    if (!(await isPivotWorkspaceAvailable(page))) {
        pass(results, `${label}: #pivot deep link ignored because pivot workspace is removed from the public site`);
        return;
    }

    const restoredPivot = await page.evaluate(() => {
        const pivot = document.getElementById('panel-pivot');
        const button = document.getElementById('tab-pivot');
        return !!(pivot && !pivot.hidden && pivot.classList.contains('active') && button && button.classList.contains('active'));
    }).catch(() => false);

    if (restoredPivot) pass(results, `${label}: #pivot deep link restores the pivot tab`);
    else fail(results, `${label}: #pivot deep link did not restore the pivot tab`);
}

async function verifyResponsiveViewports(page, results, label, baseUrl) {
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(400);
        const noOverflow = await page.evaluate((expectedWidth) => document.documentElement.scrollWidth <= expectedWidth, viewport.width).catch(() => false);
        if (noOverflow) pass(results, `${label}: ${viewport.name} viewport has no horizontal overflow`);
        else fail(results, `${label}: ${viewport.name} viewport overflowed horizontally`);
    }
}

async function verifyMobileScenarioAccess(page, results, label, baseUrl) {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoPublic(page, baseUrl);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => {
        const link = document.querySelector('a[href="#scenario"]');
        if (!link) return false;
        link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        link.click();
        return true;
    }).catch(() => false);
    if (!opened) {
        pass(results, `${label}: mobile filter-launch link removed from the public site`);
        return;
    }
    await page.waitForFunction(() => {
        const scenario = document.getElementById('scenario');
        if (!scenario) return false;
        const rect = scenario.getBoundingClientRect();
        const inView = rect.right > 0
            && rect.left < window.innerWidth
            && rect.bottom > 0
            && rect.top < window.innerHeight;
        return window.location.hash === '#scenario'
            || ((scenario.tagName !== 'DETAILS' || scenario.open) && inView);
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);

    const launch = await page.evaluate(() => {
        const scenario = document.getElementById('scenario');
        if (!scenario) return null;
        const rect = scenario.getBoundingClientRect();
        return {
            hash: window.location.hash,
            sliceOpen: scenario.tagName === 'DETAILS' ? scenario.open : false,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    }).catch(() => null);

    const launchInView = launch
        && launch.sliceOpen
        && launch.bottom > 0
        && launch.top < launch.height
        && launch.right > 0
        && launch.left < launch.width;
    if (launch && launchInView) {
        pass(results, `${label}: Launch filters opens the slice panel and scrolls it into view`);
        if (launch.hash !== '#scenario') {
            warn(results, `${label}: Launch filters opened the slice panel even though the URL hash normalized to "${launch.hash || '(empty)'}"`);
        }
    } else {
        fail(results, `${label}: Launch filters did not open the slice panel (${JSON.stringify(launch)})`);
    }

    await gotoPublic(page, baseUrl + '#scenario');
    const deepLink = await page.evaluate(() => {
        const scenario = document.getElementById('scenario');
        if (!scenario) return null;
        const rect = scenario.getBoundingClientRect();
        return {
            sliceOpen: scenario.tagName === 'DETAILS' ? scenario.open : false,
            left: rect.left,
            right: rect.right,
            width: window.innerWidth,
        };
    }).catch(() => null);

    const deepInView = deepLink
        && deepLink.sliceOpen
        && deepLink.right > 0
        && deepLink.left < deepLink.width;
    if (deepInView) {
        pass(results, `${label}: #scenario deep link opens the slice panel in view`);
    } else {
        fail(results, `${label}: #scenario deep link did not open the slice panel (${JSON.stringify(deepLink)})`);
    }
}

async function verifyMobileRail(page, results, label, baseUrl) {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
        const d = document.getElementById('table-details');
        if (d && d.tagName === 'DETAILS') d.open = true;
    });
    await page.waitForTimeout(200);
    const hasExplorer = await page.locator('#tab-explorer').count().then((n) => n > 0).catch(() => false);
    if (!hasExplorer) {
        pass(results, `${label}: mobile explorer rail removed from the public site`);
        return;
    }
    const tabExplorer = page.locator('#tab-explorer');
    await tabExplorer.scrollIntoViewIfNeeded().catch(() => {});
    await tabExplorer.click({ force: true, timeout: SEL_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(280);
    await page.waitForSelector('#panel-explorer.active', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('#rate-table .tabulator-row', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => {
        window.dispatchEvent(new Event('resize'));
        if (window.AR?.mobileTableNav?.refresh) window.AR.mobileTableNav.refresh();
    });
    await page.waitForTimeout(350);
    const visible = await waitForMobileRailVisible(page, 20000);
    if (!visible) {
        warn(results, `${label}: mobile explorer rail did not appear (layout/timing; may pass in other environments)`);
        return;
    }
    pass(results, `${label}: mobile explorer rail appears on the explorer tab`);

    await page.evaluate(() => {
        const fold = document.getElementById('table-details');
        const section = (fold && fold.tagName === 'DETAILS' && fold.open)
            ? fold
            : (document.querySelector('#panel-explorer .panel-wide') || document.getElementById('panel-explorer'));
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (!section) {
            window.scrollTo(0, Math.min(max, 320));
            return;
        }
        const rect = section.getBoundingClientRect();
        const top = window.scrollY + rect.top;
        const height = Math.max(Number(section.scrollHeight || 0), rect.height);
        const start = Math.max(0, top);
        const end = Math.max(start, top + height - window.innerHeight);
        const range = Math.max(0, end - start);
        const seeded = range > 32
            ? Math.min(Math.max(start + (range * 0.28), start + 16), end - 16)
            : Math.min(max, Math.max(start, 320));
        window.scrollTo(0, Math.min(Math.max(seeded, 0), max));
    });
    await page.waitForTimeout(120);
    const initialScrollY = await page.evaluate(() => window.scrollY).catch(() => 0);
    const railDown = page.locator('#mobile-table-rail .mobile-table-rail-btn').last();
    const railUp = page.locator('#mobile-table-rail .mobile-table-rail-btn').first();
    const RAIL_SCROLL_EPS = 12;
    const RAIL_POLL_MS = 3500;
    await railDown.click({ force: true });
    const afterDown = await pollScrollUntil(page, initialScrollY, true, RAIL_SCROLL_EPS, RAIL_POLL_MS);

    if (afterDown > initialScrollY + RAIL_SCROLL_EPS) pass(results, `${label}: mobile rail down button scrolls the page`);
    else fail(results, `${label}: mobile rail down button did not move the page`);

    await railUp.click({ force: true });
    let afterUp = await pollScrollUntil(page, afterDown, false, RAIL_SCROLL_EPS, RAIL_POLL_MS);

    if (afterUp < afterDown - RAIL_SCROLL_EPS) {
        pass(results, `${label}: mobile rail up button scrolls the page back`);
    } else {
        await railUp.click({ force: true });
        afterUp = await pollScrollUntil(page, afterDown, false, RAIL_SCROLL_EPS, 2000);
        if (afterUp < afterDown - RAIL_SCROLL_EPS) pass(results, `${label}: mobile rail up button scrolls the page back`);
        else fail(results, `${label}: mobile rail up button did not move the page upward`);
    }

    const mobilePivotTab = page.locator('#tab-pivot');
    await mobilePivotTab.scrollIntoViewIfNeeded().catch(() => {});
    await mobilePivotTab.click({ force: true, timeout: 15000 });
    await page.waitForTimeout(400);
    const hiddenOnPivot = await page.evaluate(() => {
        const rail = document.getElementById('mobile-table-rail');
        return !!(rail && rail.hidden);
    }).catch(() => false);

    if (hiddenOnPivot) pass(results, `${label}: mobile rail hides outside the explorer tab`);
    else fail(results, `${label}: mobile rail stayed visible on pivot`);

}

async function verifyMobileOverlays(page, results, label, baseUrl) {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const d = document.getElementById('table-details');
        if (d && d.tagName === 'DETAILS') d.open = true;
    });
    await page.waitForTimeout(300);

    const helpBtn = page.locator('#site-help-btn');
    const menuBtn = page.locator('#site-menu-toggle');
    if (!(await helpBtn.isVisible().catch(() => false)) || !(await menuBtn.isVisible().catch(() => false))) {
        fail(results, `${label}: mobile help or menu control is missing`);
        return;
    }

    await helpBtn.click();
    await page.waitForTimeout(300);

    const helpOpen = await page.evaluate(() => {
        const sheet = document.getElementById('site-help-sheet');
        return !!(sheet && !sheet.hidden && sheet.querySelector('.site-help-panel'));
    }).catch(() => false);

    if (helpOpen) pass(results, `${label}: mobile help opens as an isolated overlay`);
    else fail(results, `${label}: mobile help did not open`);

    await menuBtn.click();
    await page.waitForTimeout(300);

    const overlayState = await page.evaluate(() => ({
        helpOpen: !!(document.getElementById('site-help-sheet') && !document.getElementById('site-help-sheet').hidden),
        menuOpen: document.body.classList.contains('is-nav-open'),
        scrimVisible: !!(document.getElementById('site-nav-scrim') && !document.getElementById('site-nav-scrim').hidden),
        overlayLocked: document.body.classList.contains('has-overlay-open'),
    })).catch(() => ({
        helpOpen: true,
        menuOpen: false,
        scrimVisible: false,
        overlayLocked: false,
    }));

    if (overlayState.menuOpen && !overlayState.helpOpen && overlayState.scrimVisible && overlayState.overlayLocked) {
        pass(results, `${label}: mobile menu replaces help without stacked overlays`);
    } else {
        fail(results, `${label}: mobile overlays stacked or failed to lock the background`);
    }

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);

    const overlaysClosed = await page.evaluate(() => {
        const helpSheet = document.getElementById('site-help-sheet');
        const scrim = document.getElementById('site-nav-scrim');
        return !document.body.classList.contains('is-nav-open')
            && !document.body.classList.contains('has-overlay-open')
            && (!helpSheet || helpSheet.hidden)
            && (!scrim || scrim.hidden);
    }).catch(() => false);

    if (overlaysClosed) pass(results, `${label}: Escape closes mobile overlays cleanly`);
    else fail(results, `${label}: Escape did not reset mobile overlays`);
}

function attachPageNetworkCollectors(p, requestFailures, pageErrors) {
    p.on('pageerror', (error) => {
        const message = error && error.message ? error.message : String(error);
        const stack = error && error.stack ? String(error.stack) : '';
        pageErrors.push({ message, stack });
    });
    p.on('requestfailed', (request) => {
        const failure = request.failure();
        requestFailures.push({
            url: request.url(),
            error: failure && failure.errorText ? failure.errorText : 'requestfailed',
        });
    });
}

async function runOneLegalPage(context, legal, results, requestFailures, pageErrors) {
    const p = await context.newPage();
    p.setDefaultTimeout(ACTION_TIMEOUT_MS);
    attachPageNetworkCollectors(p, requestFailures, pageErrors);
    try {
        const url = withSharedQuery(legal.path);
        await gotoPublic(p, url);
        await verifyClarityPresent(p, results, legal.name);
        await verifyNoPrimaryMobileHostArtifacts(p, results, legal.name);
        await verifyPublicHeaderRefresh(p, results, legal.name);
        await verifyPublicFooter(p, results, legal.name);
        await verifyLegalMenuSimplified(p, results, legal.name);
        const state = await p.evaluate(() => ({
            title: document.title,
            body: String(document.body.textContent || '').replace(/\s+/g, ' ').trim(),
        }));

        if (state.title.includes(legal.titleIncludes) && state.body.includes(legal.bodyIncludes)) {
            pass(results, `${legal.name}: legal page is reachable with distinct content`);
        } else {
            fail(results, `${legal.name}: legal page content/title mismatch`);
        }

        if (legal.name === 'Privacy') {
            if (state.body.includes('Microsoft Clarity') && state.body.includes('Clarity may use cookies or similar browser storage')) {
                pass(results, 'Privacy: Clarity disclosure is visible on the live privacy page');
            } else {
                fail(results, 'Privacy: live privacy page is missing the Clarity disclosure');
            }
        }
    } finally {
        await closeWithTimeout(`legal tab ${legal.name}`, () => p.close());
    }
}

async function verifyLegalPagesParallel(context, results, requestFailures, pageErrors) {
    const queue = LEGAL_PAGES.slice();
    const workers = Array.from({ length: LEGAL_PAGE_CONCURRENCY }, async () => {
        while (queue.length > 0) {
            const legal = queue.shift();
            if (legal) await runOneLegalPage(context, legal, results, requestFailures, pageErrors);
        }
    });
    await Promise.all(workers);
}

async function verifyNotFoundRoute(page, results) {
    const url = withSharedQuery(INVALID_ROUTE_PATH, '/api/home-loan-rates');
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS });
    await page.waitForSelector('#main-content', { state: 'attached', timeout: SEL_TIMEOUT_MS });
    await page.waitForSelector('.site-header .site-brand', { state: 'visible', timeout: SEL_TIMEOUT_MS });
    await page.waitForTimeout(600);

    const state = await page.evaluate(() => ({
        title: String(document.title || '').trim(),
        eyebrow: String(document.querySelector('.site-header .eyebrow')?.textContent || '').trim(),
        headerTitle: String(document.querySelector('.site-header .site-header-title')?.textContent || '').trim(),
        heading: String(document.querySelector('.missing-route-panel h1')?.textContent || '').trim(),
        subtitle: String(document.querySelector('.missing-route-panel .subtitle')?.textContent || '').trim(),
        bodyClass: document.body.classList.contains('ar-not-found'),
        robots: String(document.querySelector('meta[name="robots"]')?.getAttribute('content') || '').trim(),
    })).catch(() => ({
        title: '',
        eyebrow: '',
        headerTitle: '',
        heading: '',
        subtitle: '',
        bodyClass: false,
        robots: '',
    }));

    if (
        state.bodyClass
        && state.title === 'Page not found | AustralianRates'
        && state.eyebrow === 'Not found'
        && state.headerTitle === 'Not Found'
        && state.heading === 'Page not found.'
        && /not available on AustralianRates/i.test(state.subtitle)
        && /noindex/i.test(state.robots)
    ) {
        pass(results, 'Invalid route: not-found page renders with dedicated copy and metadata');
    } else {
        fail(results, `Invalid route: not-found experience is incomplete (title="${state.title}", eyebrow="${state.eyebrow}", heading="${state.heading}")`);
    }

    const status = response ? response.status() : 0;
    if (status === 404) pass(results, 'Invalid route: HTTP status is 404');
    else fail(results, `Invalid route: expected HTTP 404 but received ${status || 'no response'}`);

    await verifyPublicHeaderRefresh(page, results, 'Invalid route');
    await verifyPublicFooter(page, results, 'Invalid route');
}

async function verifyRuntimeHealth(results, requestFailures, pageErrors) {
    const nonIgnorableFailures = requestFailures.filter((failure) => !isIgnorableTelemetryFailure(failure));
    const telemetryFailures = requestFailures.length - nonIgnorableFailures.length;

    if (telemetryFailures > 0) warn(results, `ignored ${telemetryFailures} telemetry request failure(s) from Clarity or Cloudflare Insights`);
    if (nonIgnorableFailures.length > 0) {
        fail(results, `non-ignorable request failures: ${nonIgnorableFailures.map((failure) => failure.url).join(', ')}`);
    } else {
        pass(results, 'no non-ignorable request failures during browser QA');
    }

    if (pageErrors.length > 0) {
        const stacks = pageErrors
            .map((e) => (e.stack && e.stack.trim() ? e.stack : e.message))
            .filter(Boolean);
        const unique = [...new Set(stacks)];
        unique.slice(0, 3).forEach((block) => {
            console.error('\n--- captured pageerror (first stacks) ---\n', block);
        });
        fail(results, `browser page errors detected: ${pageErrors.map((error) => error.message).join(' | ')}`);
    } else {
        pass(results, 'no browser page errors detected');
    }
}

async function verifySectionSmoke(page, results, section, noscriptBatchPromise) {
    const url = withSharedQuery(section.path, section.apiBasePath);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoPublic(page, url);
    await verifyClarityPresent(page, results, section.name);
    await verifyHeader(page, results, section.name, section.name);
    await verifyNoPrimaryMobileHostArtifacts(page, results, section.name);
    await verifyPublicHeaderRefresh(page, results, section.name);
    await verifyWorkspaceShell(page, results, section.name, section.path);
    await verifyExplorerHeading(page, results, section.name);
    await verifyExplorerTable(page, results, section.name, section.expectComparisonRate);
    await verifyHeroStats(page, results, section.name);
    await verifyStartupSettled(page, results, section.name);
    await verifyPublicFooter(page, results, section.name);
    await verifyClientLog(page, results, section.name);
    await verifyNoPublicAdminSurface(page, results, section.name);
    await verifyNoscriptFromBatch(noscriptBatchPromise, section.name, results);
    await verifyPublicTriggerRemoval(page, results, section.name);
    await verifyChartSmoke(page, results, section.name);
    await verifyHeroUpdatedAlignsWithSnapshot(page, results, section.name, section.apiBasePath, section.path);
    await page.setViewportSize({ width: 1440, height: 1200 });
}

async function runPivotSuite(page, results, phase, homeUrl) {
    const pivotUrl = `${homeUrl}#pivot`;
    await phase('homepage pivot: load');
    await gotoPublic(page, pivotUrl);

    if (!(await isPivotWorkspaceAvailable(page))) {
        pass(results, 'Homepage: #pivot deep link ignored because pivot workspace is removed from the public site');
        await verifyPivotLoad(page, results, 'Homepage');
        return;
    }

    const restoredPivot = await page.evaluate(() => {
        const panel = document.getElementById('panel-pivot');
        return window.location.hash === '#pivot' && !!(panel && !panel.hidden && panel.classList.contains('active'));
    }).catch(() => false);

    if (restoredPivot) pass(results, 'Homepage: #pivot deep link restores the pivot tab');
    else fail(results, 'Homepage: #pivot deep link did not restore the pivot tab');

    await verifyPivotLoad(page, results, 'Homepage');
}

async function runMobileSuite(page, results, phase, homeUrl) {
    await phase('homepage mobile: load');
    await gotoPublic(page, homeUrl);
    await verifyResponsiveViewports(page, results, 'Homepage', homeUrl);
    await verifyMobileScenarioAccess(page, results, 'Homepage', homeUrl);
    await verifyMobileRail(page, results, 'Homepage', homeUrl);
    await verifyMobileOverlays(page, results, 'Homepage', homeUrl);
}

async function runSectionsSuite(page, results, phase) {
    const noscriptBatchPromise = prefetchNoscriptEntries(
        SECTIONS.slice(1).map((section) => ({
            label: section.name,
            url: withSharedQuery(section.path, section.apiBasePath),
            apiBasePath: section.apiBasePath,
        })),
    );

    for (const section of SECTIONS.slice(1)) {
        await phase(`section suite: ${section.name}`);
        await verifySectionSmoke(page, results, section, noscriptBatchPromise);
    }
}

async function runTests() {
    const results = createResults();
    const requestFailures = [];
    const pageErrors = [];
    const runStarted = Date.now();

    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    if (process.env.TEST_QUIET !== '1') {
        console.log(
            `[test-homepage] Running the ${TEST_SUITE} suite against production. `
            + 'Adjust timing with TEST_POST_NAV_SETTLE_MS / TEST_SELECTOR_TIMEOUT_MS / TEST_GOTO_TIMEOUT_MS / TEST_CHART_READY_TIMEOUT_MS as needed.',
        );
    }

    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);

    page.on('pageerror', (error) => {
        const message = error && error.message ? error.message : String(error);
        const stack = error && error.stack ? String(error.stack) : '';
        pageErrors.push({ message, stack });
    });
    page.on('requestfailed', (request) => {
        const failure = request.failure();
        requestFailures.push({
            url: request.url(),
            error: failure && failure.errorText ? failure.errorText : 'requestfailed',
        });
    });

    try {
        const phase = createPhaseLogger();
        const homeUrl = withSharedQuery('/', '/api/home-loan-rates');
        if (TEST_SUITE === 'pivot') {
            await runPivotSuite(page, results, phase, homeUrl);
            await verifyRuntimeHealth(results, requestFailures, pageErrors);
            throw new Error('__suite_complete__');
        }
        if (TEST_SUITE === 'mobile') {
            await runMobileSuite(page, results, phase, homeUrl);
            await verifyRuntimeHealth(results, requestFailures, pageErrors);
            throw new Error('__suite_complete__');
        }
        if (TEST_SUITE === 'sections') {
            await runSectionsSuite(page, results, phase);
            await verifyRuntimeHealth(results, requestFailures, pageErrors);
            throw new Error('__suite_complete__');
        }
        const noscriptSpecs = [
            { label: 'Homepage', url: homeUrl, apiBasePath: '/api/home-loan-rates' },
        ];
        const noscriptBatchPromise = prefetchNoscriptEntries(noscriptSpecs);

        await phase('homepage: first load (noscript fetch started in parallel)');
        await gotoPublic(page, homeUrl);
        pass(results, 'page loaded successfully (HTTP 200)');

        const title = await page.title();
        if (title === 'Compare Australian Home Loan Rates - Daily CDR Data | AustralianRates') {
            pass(results, 'page title matches the production homepage contract');
        } else {
            fail(results, `page title mismatch (${title})`);
        }

        const description = await page.locator('meta[name=\"description\"]').getAttribute('content').catch(() => '');
        if (description && /home loan interest rates/i.test(description)) {
            pass(results, 'meta description is present and relevant');
        } else {
            fail(results, 'meta description missing or irrelevant');
        }

        await phase('homepage: shell, table, hero');
        await verifyClarityPresent(page, results, 'Homepage');
        await verifyHeader(page, results, 'Homepage', 'Home Loans');
        await verifyNoPrimaryMobileHostArtifacts(page, results, 'Homepage');
        await verifyPublicHeaderRefresh(page, results, 'Homepage');
        await verifyWorkspaceShell(page, results, 'Homepage', '/');
        await verifyExplorerHeading(page, results, 'Homepage');
        await verifyExplorerTable(page, results, 'Homepage', true);
        await verifyStartupSettled(page, results, 'Homepage');
        await verifyHeroUpdatedAlignsWithSnapshot(page, results, 'Homepage', '/api/home-loan-rates');
        await verifyPublicFooter(page, results, 'Homepage');
        await verifyNoPublicAdminSurface(page, results, 'Homepage');
        await phase('homepage: noscript check (parallel fetch)');
        await verifyNoscriptFromBatch(noscriptBatchPromise, 'Homepage', results);
        await verifyPublicTriggerRemoval(page, results, 'Homepage');
        await phase('homepage: chart');
        await verifyChartSmoke(page, results, 'Homepage');
        await phase('404 route + runtime health');
        await verifyNotFoundRoute(page, results);
        await verifyRuntimeHealth(results, requestFailures, pageErrors);
    } catch (error) {
        if (error && error.message !== '__suite_complete__') {
            fail(results, `fatal error during testing: ${error.message}`);
            await page.screenshot({
                path: `${SCREENSHOT_DIR}/homepage-error.png`,
                fullPage: true,
            }).catch(() => {});
        }
    } finally {
        if (results.failed.length > 0) {
            await page.screenshot({
                path: `${SCREENSHOT_DIR}/homepage-${TEST_SUITE}-failure.png`,
                fullPage: true,
            }).catch(() => {});
        }
        await closeWithTimeout('Playwright context', () => context.close());
        await closeWithTimeout('Playwright browser', () => browser.close());
    }

    console.log('\n========================================');
    console.log(`TEST RESULTS SUMMARY (${TEST_SUITE})`);
    console.log('========================================\n');

    console.log(`PASSED: ${results.passed.length} tests`);
    results.passed.forEach((message) => console.log(message));

    if (results.warnings.length > 0) {
        console.log(`\nWARNINGS: ${results.warnings.length}`);
        results.warnings.forEach((message) => console.log(message));
    }

    if (results.failed.length > 0) {
        console.log(`\nFAILED: ${results.failed.length} tests`);
        results.failed.forEach((message) => console.log(message));
    }

    console.log('\n========================================');
    console.log(`Total Tests: ${results.passed.length + results.failed.length}`);
    console.log(`Pass Rate: ${((results.passed.length / Math.max(results.passed.length + results.failed.length, 1)) * 100).toFixed(1)}%`);
    const wallSec = ((Date.now() - runStarted) / 1000).toFixed(1);
    console.log(`Wall time: ${wallSec}s`);
    console.log('========================================\n');
    console.log(`Failure artifacts directory: ${SCREENSHOT_DIR}/`);

    process.exit(results.failed.length > 0 ? 1 : 0);
}

runTests().catch((error) => {
    console.error('Failed to run tests:', error);
    process.exit(1);
});
