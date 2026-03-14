// @ts-nocheck
const fs = require('fs');
const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const SCREENSHOT_DIR = './test-screenshots';
const testUrlObj = new URL(TEST_URL);
const baseOrigin = testUrlObj.origin;
const sharedParams = new URLSearchParams(testUrlObj.search || '');
const isProductionUrl = /^https:\/\/www\.australianrates\.com\/?/i.test(TEST_URL);
const CLARITY_PROJECT_ID = 'vt4vtenviy';
const CLARITY_SRC = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
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

async function gotoPublic(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#main-content', { timeout: 15000 });
    await page.waitForSelector('.site-header .site-brand', { timeout: 15000 });
    await page.waitForTimeout(2500);
}

async function waitForExplorerTableReady(page, timeout = 25000) {
    await page.waitForFunction(() => {
        const table = document.getElementById('rate-table');
        if (!table) return false;
        if (table.querySelectorAll('.tabulator-row').length > 0) return true;
        const placeholder = table.querySelector('.tabulator-placeholder');
        return !!(placeholder && String(placeholder.textContent || '').trim().length > 0);
    }, null, { timeout });
}

async function waitForChartReady(page, timeout = 90000) {
    await page.waitForFunction(() => {
        const output = document.getElementById('chart-output');
        if (!output) return false;
        const rendered = output.getAttribute('data-chart-engine') === 'echarts' || !!output.querySelector('canvas') || !!output.querySelector('svg');
        if (!rendered) return false;
        const status = String((document.getElementById('chart-status') || {}).textContent || '').trim().toLowerCase();
        return status.indexOf('err') === -1;
    }, null, { timeout });
    await page.waitForTimeout(1200);
}

async function waitForMobileRailVisible(page, timeout = 15000) {
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

async function openFooterTechnical(page) {
    const summary = page.locator('#footer-technical > summary');
    const visible = await summary.isVisible().catch(() => false);
    if (!visible) return false;
    const alreadyOpen = await page.locator('#footer-technical').evaluate((el) => !!el.open).catch(() => false);
    if (!alreadyOpen) {
        await summary.click();
        await page.waitForTimeout(200);
    }
    return true;
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

async function verifyWorkspaceShell(page, results, label) {
    const shell = await page.evaluate(() => ({
        marketTerminal: !!document.querySelector('.market-terminal'),
        introSteps: Array.from(document.querySelectorAll('.market-intro-step-index')).map((el) => String(el.textContent || '').trim()),
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
            bank: !!document.getElementById('filter-bank'),
            apply: !!document.getElementById('apply-filters'),
            download: !!document.getElementById('download-format'),
            draw: !!document.getElementById('draw-chart'),
            summary: !!document.getElementById('chart-summary'),
            ladder: !!document.getElementById('quick-compare-cards'),
        },
    }));

    if (shell.marketTerminal) pass(results, `${label}: market workspace renders`);
    else fail(results, `${label}: market workspace missing`);

    if (shell.introSteps.join(',') === '01,02,03' && !shell.hasObjectStringLeak) {
        pass(results, `${label}: intro steps render stable numeric badges without object-string leakage`);
    } else {
        fail(results, `${label}: intro steps are malformed (${shell.introSteps.join(', ') || 'missing'})`);
    }

    const expectedChartViews = ['Leaders', 'Movement', 'Compare', 'Distribution'];
    const actualChartViews = shell.chartViews.map((view) => view.label);
    if (expectedChartViews.every((view) => actualChartViews.includes(view)) && shell.chartViews.every((view) => view.hasIcon)) {
        pass(results, `${label}: chart view controls render with icon labels`);
    } else {
        fail(results, `${label}: chart view controls mismatch (${actualChartViews.join(', ')})`);
    }

    const expectedTabs = ['Table', 'Pivot', 'History', 'Changes'];
    const actualTabs = shell.tabs.map((tab) => tab.label);
    if (expectedTabs.every((tab) => actualTabs.includes(tab)) && shell.tabs.every((tab) => tab.hasIcon)) {
        pass(results, `${label}: workspace tabs render with icon labels`);
    } else {
        fail(results, `${label}: workspace tabs mismatch (${actualTabs.join(', ')})`);
    }

    const activeExplorer = shell.tabs.find((tab) => tab.id === 'tab-explorer' && tab.active);
    if (activeExplorer) pass(results, `${label}: explorer tab is active on load`);
    else fail(results, `${label}: explorer tab is not active on load`);

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
    } else {
        fail(results, `${label}: Clarity bootstrap missing or incorrect (id="${state.scriptId}", src="${state.scriptSrc}", count=${state.matchingScripts})`);
    }
}

async function verifyHeroStats(page, results, label) {
    await page.waitForFunction(() => {
        const stats = Array.from(document.querySelectorAll('#hero-stats .terminal-stat'));
        if (stats.length !== 3) return false;
        return stats.every((el) => {
            const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            return text.length > 0 && text.indexOf('...') === -1;
        });
    }, null, { timeout: 15000 }).catch(() => null);

    const stats = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#hero-stats .terminal-stat')).map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim());
    });
    if (stats.length === 3 && stats.every((text) => text.length > 0 && text.indexOf('...') === -1)) {
        pass(results, `${label}: summary stats loaded`);
    } else {
        fail(results, `${label}: summary stats incomplete (${stats.join(' | ') || 'none'})`);
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

    await dragRail('#left-rail-resizer', '--ar-left-rail-width', 60, 'left rail resizer');
    await dragRail('#right-rail-resizer', '--ar-right-rail-width', -60, 'right rail resizer');

    await page.locator('#rate-table').scrollIntoViewIfNeeded().catch(() => {});
    await page.click('#table-settings-btn');
    await page.locator('#table-settings-popover input[data-setting="move-columns"]').check();
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

    await page.locator('#rate-table .ar-move-col-btn-right').first().click().catch(() => {});
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

async function verifyFooterDeployStatus(page, results, label) {
    await openFooterTechnical(page);
    await page.waitForFunction(() => {
        const text = String(document.getElementById('footer-commit')?.textContent || '').trim();
        return text.length > 0 && text !== 'Loading commit info...';
    }, null, { timeout: 15000 }).catch(() => null);

    const text = await page.locator('#footer-commit').textContent().catch(() => '');
    const value = String(text || '').trim();

    if (/^LIVE \| deploy [0-9a-f]{7,} \| build /i.test(value)) {
        pass(results, `${label}: footer deploy status is live with deploy/build details`);
        return;
    }
    if (!isProductionUrl && /UNKNOWN/i.test(value)) {
        warn(results, `${label}: footer deploy status is Unknown on local/non-production test URL`);
        return;
    }
    fail(results, `${label}: footer deploy status is invalid (${value || 'missing'})`);
}

async function verifyFooterLogControls(page, results, label) {
    const opened = await openFooterTechnical(page);
    if (!opened) {
        fail(results, `${label}: footer technical section missing`);
        return;
    }

    const logLink = page.locator('#footer-log-link');
    if (!(await logLink.isVisible().catch(() => false))) {
        fail(results, `${label}: footer log link missing`);
        return;
    }

    await logLink.click();
    await page.waitForTimeout(250);

    const popup = await page.evaluate(() => {
        const node = document.getElementById('footer-log-popup');
        return {
            visible: !!(node && !node.hidden),
            clientAction: String(document.getElementById('footer-log-download-client')?.textContent || '').trim(),
            systemActionCount: document.querySelectorAll('#footer-log-download-system').length,
        };
    });

    if (popup.visible && popup.clientAction === 'Download client log') {
        pass(results, `${label}: footer log popup exposes client download only`);
    } else {
        fail(results, `${label}: footer log popup is incomplete`);
    }

    if (popup.systemActionCount === 0) pass(results, `${label}: public system log download remains disabled`);
    else fail(results, `${label}: public system log download should not be exposed`);

    await page.mouse.click(5, 5).catch(() => {});
}

async function verifyFooterLegalLinks(page, results, label) {
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.site-footer-meta a[href]')).map((el) => ({
            text: String(el.textContent || '').trim(),
            href: String(el.getAttribute('href') || '').trim(),
        }));
    });

    const expected = [
        { text: 'About', href: '/about/' },
        { text: 'Contact', href: '/contact/' },
        { text: 'Privacy', href: '/privacy/' },
        { text: 'Terms', href: '/terms/' },
    ];

    const missing = expected.filter((item) => !links.some((link) => link.text === item.text && link.href === item.href));
    if (missing.length === 0) pass(results, `${label}: footer legal links render`);
    else fail(results, `${label}: missing footer legal links (${missing.map((item) => item.text).join(', ')})`);
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

async function verifyNoScriptFallback(url, apiBasePath, results, label) {
    try {
        const response = await fetch(url, { redirect: 'follow' });
        const html = await response.text();
        if (response.status !== 200) {
            fail(results, `${label}: noscript HTML fetch failed (${response.status})`);
            return;
        }

        const needles = [
            '<noscript',
            `${apiBasePath}/export.csv`,
            `${apiBasePath}/filters`,
            `${apiBasePath}/health`,
        ];
        const missing = needles.filter((needle) => html.indexOf(needle) === -1);
        if (missing.length === 0) pass(results, `${label}: noscript API fallback links exist`);
        else fail(results, `${label}: noscript fallback missing ${missing.join(', ')}`);
    } catch (error) {
        fail(results, `${label}: noscript fetch errored (${error.message})`);
    }
}

async function verifyPublicTriggerRemoval(page, results, label) {
    const count = await page.locator('#trigger-run').count().catch(() => 0);
    if (count === 0) pass(results, `${label}: public trigger controls remain removed`);
    else fail(results, `${label}: public trigger control leaked back in`);
}

async function verifyChartSmoke(page, results, label) {
    const button = page.locator('#draw-chart');
    if (!(await button.isVisible().catch(() => false))) {
        fail(results, `${label}: draw-chart button missing`);
        return;
    }

    await button.click();
    await waitForChartReady(page);

    const chart = await page.evaluate(() => ({
        engine: String(document.getElementById('chart-output')?.getAttribute('data-chart-engine') || ''),
        canvases: document.querySelectorAll('#chart-output canvas').length,
        status: String(document.getElementById('chart-status')?.textContent || '').trim(),
        summary: String(document.getElementById('chart-summary')?.textContent || '').trim(),
    }));

    if ((chart.engine === 'echarts' || chart.canvases > 0) && chart.status) {
        pass(results, `${label}: chart draw renders ECharts output`);
    } else {
        fail(results, `${label}: chart draw did not render`);
    }

    if (chart.summary && chart.summary !== 'WAIT') pass(results, `${label}: chart summary updates after draw`);
    else fail(results, `${label}: chart summary did not populate after draw`);
}

async function verifyPivotLoad(page, results, label) {
    await page.click('#tab-pivot');
    await page.waitForTimeout(300);

    const pivotVisible = await page.evaluate(() => {
        const panel = document.getElementById('panel-pivot');
        return !!(panel && !panel.hidden && panel.classList.contains('active'));
    }).catch(() => false);

    if (!pivotVisible) {
        fail(results, `${label}: pivot tab did not activate`);
        return;
    }

    await page.click('#load-pivot');
    await page.waitForFunction(() => {
        return !!document.querySelector('#pivot-output .pvtUi');
    }, null, { timeout: 45000 }).catch(() => null);

    const pivotReady = await page.evaluate(() => {
        return {
            status: String(document.getElementById('pivot-status')?.textContent || '').trim(),
            hasUi: !!document.querySelector('#pivot-output .pvtUi'),
        };
    }).catch(() => ({ status: '', hasUi: false }));

    if (pivotReady.hasUi && /loaded/i.test(pivotReady.status)) {
        pass(results, `${label}: pivot workspace loads rows`);
    } else {
        fail(results, `${label}: pivot workspace did not load`);
    }
}

async function verifyExportRequest(page, results, label) {
    const requests = [];
    const handler = (request) => {
        const url = String(request.url() || '');
        if (url.indexOf('/exports') >= 0) {
            requests.push({
                method: request.method(),
                url: url,
            });
        }
    };

    page.context().on('request', handler);
    try {
        await page.selectOption('#download-format', 'csv');
        await page.waitForFunction(() => String(document.getElementById('download-format')?.value || '') === '', null, { timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(600);
    } finally {
        page.context().off('request', handler);
    }

    const started = requests.some((request) => request.method === 'POST' && /\/exports$/.test(new URL(request.url).pathname));
    if (started) pass(results, `${label}: CSV export starts an async export job`);
    else fail(results, `${label}: CSV export did not start an export job`);
}

async function verifyTabsAndHash(page, results, label, baseUrl) {
    const scenarios = [
        { tabId: '#tab-pivot', panelId: '#panel-pivot', hash: '#pivot', name: 'pivot' },
        { tabId: '#tab-history', panelId: '#panel-history', hash: '#history', name: 'history' },
        { tabId: '#tab-changes', panelId: '#panel-changes', hash: '#changes', name: 'changes' },
        { tabId: '#tab-explorer', panelId: '#panel-explorer', hash: '#table', name: 'explorer' },
    ];

    for (const scenario of scenarios) {
        await page.click(scenario.tabId);
        await page.waitForTimeout(250);
        const state = await page.evaluate((panelId) => {
            const panel = document.querySelector(panelId);
            return !!(panel && !panel.hidden && panel.classList.contains('active'));
        }, scenario.panelId).catch(() => false);
        const currentHash = new URL(page.url()).hash;

        if (state && currentHash === scenario.hash) pass(results, `${label}: ${scenario.name} tab updates the active panel and URL hash`);
        else fail(results, `${label}: ${scenario.name} tab/hash sync failed`);
    }

    await gotoPublic(page, baseUrl + '#pivot');
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
        await gotoPublic(page, baseUrl);
        await waitForExplorerTableReady(page);
        const noOverflow = await page.evaluate((expectedWidth) => document.documentElement.scrollWidth <= expectedWidth, viewport.width).catch(() => false);
        if (noOverflow) pass(results, `${label}: ${viewport.name} viewport has no horizontal overflow`);
        else fail(results, `${label}: ${viewport.name} viewport overflowed horizontally`);
    }
}

async function verifyMobileRail(page, results, label, baseUrl) {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoPublic(page, baseUrl);
    await waitForExplorerTableReady(page);

    const visible = await waitForMobileRailVisible(page);
    if (!visible) {
        fail(results, `${label}: mobile explorer rail did not appear`);
        return;
    }
    pass(results, `${label}: mobile explorer rail appears on the explorer tab`);

    const initialScrollY = await page.evaluate(() => window.scrollY).catch(() => 0);
    await page.locator('#mobile-table-rail .mobile-table-rail-btn').last().click({ force: true });
    await page.waitForTimeout(1200);
    const afterDown = await page.evaluate(() => window.scrollY).catch(() => initialScrollY);

    if (afterDown > initialScrollY + 20) pass(results, `${label}: mobile rail down button scrolls the page`);
    else fail(results, `${label}: mobile rail down button did not move the page`);

    await page.locator('#mobile-table-rail .mobile-table-rail-btn').first().click({ force: true });
    await page.waitForTimeout(1200);
    const afterUp = await page.evaluate(() => window.scrollY).catch(() => afterDown);

    if (afterUp < afterDown - 20) pass(results, `${label}: mobile rail up button scrolls the page back`);
    else fail(results, `${label}: mobile rail up button did not move the page upward`);

    await page.click('#tab-pivot');
    await page.waitForTimeout(400);
    const hiddenOnPivot = await page.evaluate(() => {
        const rail = document.getElementById('mobile-table-rail');
        return !!(rail && rail.hidden);
    }).catch(() => false);

    if (hiddenOnPivot) pass(results, `${label}: mobile rail hides outside the explorer tab`);
    else fail(results, `${label}: mobile rail stayed visible on pivot`);

    await page.screenshot({
        path: `${SCREENSHOT_DIR}/mobile-homepage.png`,
        fullPage: true,
    }).catch(() => {});
}

async function verifyLegalPages(page, results) {
    for (const legal of LEGAL_PAGES) {
        const url = withSharedQuery(legal.path);
        await gotoPublic(page, url);
        await verifyClarityPresent(page, results, legal.name);
        const state = await page.evaluate(() => ({
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
    }
}

async function verifyRuntimeHealth(results, requestFailures, pageErrors) {
    const nonIgnorableFailures = requestFailures.filter((failure) => !isIgnorableTelemetryFailure(failure));
    const telemetryFailures = requestFailures.length - nonIgnorableFailures.length;

    if (telemetryFailures > 0) pass(results, `ignored ${telemetryFailures} telemetry request failure(s) from Clarity or Cloudflare Insights`);
    if (nonIgnorableFailures.length > 0) {
        fail(results, `non-ignorable request failures: ${nonIgnorableFailures.map((failure) => failure.url).join(', ')}`);
    } else {
        pass(results, 'no non-ignorable request failures during browser QA');
    }

    if (pageErrors.length > 0) {
        fail(results, `browser page errors detected: ${pageErrors.map((error) => error.message).join(' | ')}`);
    } else {
        pass(results, 'no browser page errors detected');
    }
}

async function verifySectionSmoke(page, results, section) {
    const url = withSharedQuery(section.path, section.apiBasePath);
    await gotoPublic(page, url);
    await verifyClarityPresent(page, results, section.name);
    await verifyHeader(page, results, section.name, section.name);
    await verifyWorkspaceShell(page, results, section.name);
    await verifyHeroStats(page, results, section.name);
    await verifyExplorerTable(page, results, section.name, section.expectComparisonRate);
    await verifyFooterDeployStatus(page, results, section.name);
    await verifyFooterLogControls(page, results, section.name);
    await verifyFooterLegalLinks(page, results, section.name);
    await verifyClientLog(page, results, section.name);
    await verifyNoPublicAdminSurface(page, results, section.name);
    await verifyNoScriptFallback(url, section.apiBasePath, results, section.name);
    await verifyPublicTriggerRemoval(page, results, section.name);
    await verifyChartSmoke(page, results, section.name);
}

async function runTests() {
    const results = createResults();
    const requestFailures = [];
    const pageErrors = [];

    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();

    page.on('pageerror', (error) => {
        pageErrors.push({ message: error && error.message ? error.message : String(error) });
    });
    page.on('requestfailed', (request) => {
        const failure = request.failure();
        requestFailures.push({
            url: request.url(),
            error: failure && failure.errorText ? failure.errorText : 'requestfailed',
        });
    });

    try {
        const homeUrl = withSharedQuery('/', '/api/home-loan-rates');
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

        await verifySkipLink(page, results, 'Homepage');
        await verifyClarityPresent(page, results, 'Homepage');
        await verifyHeader(page, results, 'Homepage', 'Home Loans');
        await verifyWorkspaceShell(page, results, 'Homepage');
        await verifyHeroStats(page, results, 'Homepage');
        await verifyExplorerTable(page, results, 'Homepage', true);
        await verifyBankBadgeLogos(page, results, 'Homepage');
        await verifyFooterDeployStatus(page, results, 'Homepage');
        await verifyFooterLogControls(page, results, 'Homepage');
        await verifyFooterLegalLinks(page, results, 'Homepage');
        await verifyClientLog(page, results, 'Homepage');
        await verifyNoPublicAdminSurface(page, results, 'Homepage');
        await verifyNoScriptFallback(homeUrl, '/api/home-loan-rates', results, 'Homepage');
        await verifyPublicTriggerRemoval(page, results, 'Homepage');
        await verifyChartSmoke(page, results, 'Homepage');
        await verifyPivotLoad(page, results, 'Homepage');
        await verifyExportRequest(page, results, 'Homepage');
        await verifyDesktopWorkspaceControls(page, results, 'Homepage', homeUrl);
        await verifyTabsAndHash(page, results, 'Homepage', homeUrl);
        await verifyResponsiveViewports(page, results, 'Homepage', homeUrl);
        await verifyMobileRail(page, results, 'Homepage', homeUrl);

        await page.setViewportSize({ width: 1440, height: 1200 });
        await gotoPublic(page, homeUrl);
        await page.screenshot({
            path: `${SCREENSHOT_DIR}/homepage-desktop.png`,
            fullPage: true,
        }).catch(() => {});

        for (const section of SECTIONS.slice(1)) {
            await verifySectionSmoke(page, results, section);
        }

        await verifyLegalPages(page, results);
        await verifyRuntimeHealth(results, requestFailures, pageErrors);
    } catch (error) {
        fail(results, `fatal error during testing: ${error.message}`);
        await page.screenshot({
            path: `${SCREENSHOT_DIR}/homepage-error.png`,
            fullPage: true,
        }).catch(() => {});
    } finally {
        await browser.close();
    }

    console.log('\n========================================');
    console.log('TEST RESULTS SUMMARY');
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
    console.log('========================================\n');
    console.log(`Screenshots saved to: ${SCREENSHOT_DIR}/`);

    process.exit(results.failed.length > 0 ? 1 : 0);
}

runTests().catch((error) => {
    console.error('Failed to run tests:', error);
    process.exit(1);
});
