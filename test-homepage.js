/**
 * Australian Rates Homepage Test Script
 * 
 * This script tests the homepage functionality including:
 * - Page load and title
 * - Hero section elements
 * - Header branding
 * - Tab buttons and navigation
 * - Filter dropdowns with populated options
 * - Rate Explorer table data
 * - Disclaimer text
 * - Responsive design
 * 
 * Run with: node test-homepage.js
 * Requires: playwright (npm install playwright)
 */

const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const SCREENSHOT_DIR = './test-screenshots';
// New explorer-column checks are strict on localhost/dev and optional on production until rollout is complete.
const isProductionUrl = !TEST_URL.includes('localhost') && !TEST_URL.includes('127.0.0.1');
const STRICT_RETRIEVAL_COLUMN = isProductionUrl || process.env.STRICT_RETRIEVAL_COLUMN === '1';
const STRICT_NEW_EXPLORER_COLUMNS = !isProductionUrl || process.env.STRICT_NEW_EXPLORER_COLUMNS === '1';
const STRICT_RBA_CASH_RATE = !isProductionUrl || process.env.STRICT_RBA_CASH_RATE === '1';
const REQUIRED_METADATA_HEADERS = ['Found:', 'Headline Rate', 'Bank', 'Rate Confirmed', 'URLs'];

function isIgnorableTelemetryFailure(failure) {
    if (!failure || !failure.url) return false;
    const url = String(failure.url);
    const error = String(failure.error || '');
    return url.includes('static.cloudflareinsights.com/beacon.min.js') && error.includes('ERR_NAME_NOT_RESOLVED');
}

async function runTests() {
    console.log('Starting Australian Rates Homepage Tests...');
    console.log(`Target URL: ${TEST_URL}\n`);
    
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();
    const testUrlObj = new URL(TEST_URL);
    const baseOrigin = testUrlObj.origin;
    const sharedQuery = testUrlObj.search || '';
    const withSharedQuery = (path) => {
        if (!sharedQuery) return baseOrigin + path;
        return baseOrigin + path + sharedQuery;
    };
    
    const fs = require('fs');
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR);
    }
    
    const results = {
        passed: [],
        failed: [],
        warnings: []
    };

    function verifyMetadataHeaders(headers, scopeLabel) {
        const normalized = headers.map(h => String(h).trim());
        for (const header of REQUIRED_METADATA_HEADERS) {
            const hasHeader = normalized.includes(header);
            if (hasHeader) {
                results.passed.push(`PASS ${scopeLabel}: table includes ${header} column`);
            } else if (STRICT_NEW_EXPLORER_COLUMNS) {
                results.failed.push(`FAIL ${scopeLabel}: table missing ${header} column`);
            } else {
                results.warnings.push(`WARN ${scopeLabel}: table missing ${header} column on this environment`);
            }
        }
        if (normalized.includes('Comparison Rate')) {
            results.passed.push(`PASS ${scopeLabel}: table includes Comparison Rate when available`);
        } else {
            results.warnings.push(`WARN ${scopeLabel}: table currently hides Comparison Rate (likely no comparison values in this slice)`);
        }
        if (normalized.includes('Retrieved At')) {
            if (STRICT_NEW_EXPLORER_COLUMNS) results.failed.push(`FAIL ${scopeLabel}: table still includes obsolete Retrieved At column`);
            else results.warnings.push(`WARN ${scopeLabel}: table still includes obsolete Retrieved At column on this environment`);
        } else {
            results.passed.push(`PASS ${scopeLabel}: table no longer includes Retrieved At`);
        }
    }

    async function verifyFooterDeployStatus(label) {
        await page.waitForFunction(() => {
            const el = document.getElementById('footer-commit');
            if (!el) return false;
            const txt = String(el.textContent || '');
            return txt.includes('In sync') || txt.includes('Behind') || txt.includes('Unknown');
        }, { timeout: 12000 }).catch(() => null);

        const footerText = await page.textContent('#footer-commit').catch(() => '');
        if (footerText && (footerText.includes('In sync') || footerText.includes('Behind'))) {
            results.passed.push(`âœ“ ${label}: footer deploy status is clear (${footerText.trim()})`);
            return;
        }
        if (footerText && footerText.includes('Unknown')) {
            results.failed.push(`âœ— ${label}: footer deploy status is Unknown (must be In sync or Behind)`);
            return;
        }
        results.failed.push(`âœ— ${label}: footer deploy status missing or unreadable (${footerText || 'no text'})`);
    }

    async function verifyFooterLogControls(label) {
        const systemHref = await page.getAttribute('#footer-log-download-system', 'href').catch(() => '');
        if (systemHref && systemHref.includes('/api/home-loan-rates/logs')) {
            results.passed.push(`âœ“ ${label}: system log endpoint uses /api/home-loan-rates/logs`);
        } else {
            results.failed.push(`âœ— ${label}: system log endpoint is incorrect (${systemHref || 'missing'})`);
        }

        const linkVisible = await page.locator('#footer-log-link').isVisible().catch(() => false);
        if (!linkVisible) {
            results.failed.push(`âœ— ${label}: footer log link not visible`);
            return;
        }

        await page.click('#footer-log-link');
        await page.waitForTimeout(250);
        const popupVisible = await page.evaluate(() => {
            const popup = document.getElementById('footer-log-popup');
            return !!(popup && !popup.hidden);
        }).catch(() => false);
        const clientItemText = await page.textContent('#footer-log-download-client').catch(() => '');
        if (popupVisible && clientItemText && clientItemText.includes('Download client log')) {
            results.passed.push(`âœ“ ${label}: footer popup includes "Download client log"`);
        } else {
            results.failed.push(`âœ— ${label}: footer popup missing client log download action`);
        }

        await page.click('body', { position: { x: 1, y: 1 } }).catch(() => {});
    }

    async function verifyClientLogIsRich(label, minCount) {
        const ready = await page.waitForFunction(
            (threshold) => typeof window.getSessionLogEntries === 'function' && window.getSessionLogEntries().length >= threshold,
            minCount,
            { timeout: 10000 }
        ).catch(() => null);

        if (!ready) {
            results.failed.push(`âœ— ${label}: client log did not reach ${minCount} entries`);
            return;
        }

        const clientLogData = await page.evaluate(() => {
            const entries = (typeof window.getSessionLogEntries === 'function') ? window.getSessionLogEntries() : [];
            const messages = entries.map(e => String(e.message || ''));
            return { count: entries.length, messages };
        });
        const hasAppSignal = clientLogData.messages.some(msg =>
            msg.includes('App init') ||
            msg.includes('Filter options') ||
            msg.includes('Hero stats') ||
            msg.includes('Explorer') ||
            msg.includes('Pivot') ||
            msg.includes('Chart') ||
            msg.includes('Manual run')
        );

        if (clientLogData.count >= minCount && hasAppSignal) {
            results.passed.push(`âœ“ ${label}: client log is rich (${clientLogData.count} entries with app lifecycle events)`);
        } else if (!hasAppSignal) {
            results.failed.push(`âœ— ${label}: client log missing app lifecycle events`);
        } else {
            results.failed.push(`âœ— ${label}: client log count too low (${clientLogData.count})`);
        }
    }

    async function verifyFooterLegalLinks(label) {
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.footer-legal-links a')).map((a) => ({
                text: String(a.textContent || '').trim(),
                href: String(a.getAttribute('href') || '').trim(),
            }));
        }).catch(() => []);

        const expected = [
            { text: 'About', href: '/about/' },
            { text: 'Privacy', href: '/privacy/' },
            { text: 'Terms', href: '/terms/' },
            { text: 'Contact', href: '/contact/' },
        ];

        let ok = true;
        for (const item of expected) {
            const found = links.find((x) => x.text === item.text && x.href === item.href);
            if (!found) ok = false;
        }
        if (ok) {
            results.passed.push(`✓ ${label}: footer legal links are present`);
        } else {
            results.failed.push(`✗ ${label}: missing one or more footer legal links`);
        }
    }

    async function verifyNoPublicAdminSurface(label) {
        const adminLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href], [data-admin], .admin-link, .admin-entry, .footer-admin-at'))
                .map((el) => {
                    const href = (el.tagName === 'A') ? String(el.getAttribute('href') || '') : '';
                    return href;
                })
                .filter((href) => href.includes('/admin') || href === 'admin/' || href === '../admin/');
        }).catch(() => []);

        if (adminLinks.length === 0) {
            results.passed.push(`✓ ${label}: no discoverable public admin links`);
        } else {
            results.failed.push(`✗ ${label}: public admin links are still present (${adminLinks.join(', ')})`);
        }

        const beforeUrl = page.url();
        await page.keyboard.down('Control');
        await page.keyboard.down('Alt');
        await page.keyboard.down('Shift');
        await page.keyboard.press('A');
        await page.keyboard.up('Shift');
        await page.keyboard.up('Alt');
        await page.keyboard.up('Control');
        await page.waitForTimeout(250);
        const afterUrl = page.url();
        if (afterUrl === beforeUrl) {
            results.passed.push(`✓ ${label}: no public keyboard shortcut navigates to admin`);
        } else {
            results.failed.push(`✗ ${label}: keyboard shortcut changed URL unexpectedly (${afterUrl})`);
        }
    }

    async function verifyNoScriptFallback(url, label, apiBasePath) {
        try {
            const res = await fetch(url, { redirect: 'follow' });
            const html = await res.text();
            if (res.status !== 200) {
                results.failed.push(`✗ ${label}: HTML fetch failed (${res.status})`);
                return;
            }
            const checks = [
                '<noscript',
                `${apiBasePath}/export.csv`,
                `${apiBasePath}/filters`,
                `${apiBasePath}/health`,
            ];
            const allPresent = checks.every((needle) => html.includes(needle));
            if (allPresent) {
                results.passed.push(`✓ ${label}: noscript fallback links present`);
            } else {
                results.failed.push(`✗ ${label}: noscript fallback block or links missing`);
            }
        } catch (err) {
            results.failed.push(`✗ ${label}: noscript fallback fetch error (${err.message})`);
        }
    }

    async function verifyLegalPagesDistinct() {
        const pages = [
            { name: 'About', path: '/about/', titleIncludes: 'About AustralianRates' },
            { name: 'Privacy', path: '/privacy/', titleIncludes: 'Privacy Policy' },
            { name: 'Terms', path: '/terms/', titleIncludes: 'Terms of Use' },
            { name: 'Contact', path: '/contact/', titleIncludes: 'Contact AustralianRates' },
        ];

        for (const legal of pages) {
            const url = withSharedQuery(legal.path);
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const title = await page.title();
            const bodyText = await page.textContent('body').catch(() => '');
            if (response && response.status() === 200 && title.includes(legal.titleIncludes) && bodyText.includes('support@australianrates.com')) {
                results.passed.push(`✓ ${legal.name} page is reachable with distinct content`);
            } else {
                results.failed.push(`✗ ${legal.name} page validation failed (status/title/content mismatch)`);
            }
        }
    }
    
    try {
        // Test 1: Page loads without errors
        console.log('Test 1: Navigating to homepage...');
        const navigationErrors = [];
        const pageErrors = [];
        const requestFailures = [];
        
        page.on('console', msg => {
            if (msg.type() === 'error') {
                navigationErrors.push(msg.text());
            }
        });
        
        page.on('pageerror', error => {
            pageErrors.push(error.message);
        });

        page.on('requestfailed', request => {
            requestFailures.push({
                url: request.url(),
                error: (request.failure() && request.failure().errorText) ? request.failure().errorText : ''
            });
        });
        
        const response = await page.goto(TEST_URL, { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });
        
        if (response.status() === 200) {
            results.passed.push('✓ Page loaded successfully (HTTP 200)');
        } else {
            results.failed.push(`✗ Page returned HTTP ${response.status()}`);
        }
        
        // Wait for main content to load
        await page.waitForSelector('#main-content', { timeout: 10000 });
        
        // Wait for hero stats to load (they start as "..." and get populated)
        console.log('  Waiting for hero stats to load...');
        try {
            await page.waitForFunction(() => {
                const statUpdated = document.getElementById('stat-updated');
                const statCashRate = document.getElementById('stat-cash-rate');
                const statRecords = document.getElementById('stat-records');
                return statUpdated && !statUpdated.textContent.includes('...') &&
                       statCashRate && !statCashRate.textContent.includes('...') &&
                       statRecords && !statRecords.textContent.includes('...');
            }, { timeout: 15000 });
            console.log('  Hero stats loaded successfully');
        } catch (e) {
            console.log('  Warning: Hero stats did not load within 15 seconds');
        }
        
        // Wait for Rate Explorer table to initialize
        console.log('  Waiting for Rate Explorer table to load...');
        try {
            await page.waitForSelector('#rate-table .tabulator', { timeout: 25000 });
            await page.waitForTimeout(2000); // Give it time to populate rows
            console.log('  Rate Explorer table loaded');
        } catch (e) {
            console.log('  Warning: Rate Explorer table did not load within 25 seconds');
        }
        
        // Take full page screenshot
        await page.screenshot({ 
            path: `${SCREENSHOT_DIR}/01-full-page-load.png`,
            fullPage: true 
        });
        console.log('  Screenshot saved: 01-full-page-load.png');
        
        if (navigationErrors.length === 0) {
            results.passed.push('✓ No console errors during page load');
        } else {
            results.warnings.push(`⚠ Console errors detected: ${navigationErrors.length}`);
            console.log('  Console errors:', navigationErrors);
        }
        
        const legacyConsoleWarningToken = 'Console errors detected:';
        const ignorableRequestFailures = requestFailures.filter(isIgnorableTelemetryFailure);
        const actionableRequestFailures = requestFailures.filter((failure) => !isIgnorableTelemetryFailure(failure));
        const actionableConsoleErrors = navigationErrors.filter((msg) => {
            if (!msg.includes('Failed to load resource: net::ERR_NAME_NOT_RESOLVED')) return true;
            return ignorableRequestFailures.length === 0;
        });
        const loadIssueCount = actionableConsoleErrors.length + pageErrors.length + actionableRequestFailures.length;
        if (loadIssueCount === 0) {
            results.warnings = results.warnings.filter((msg) => !msg.includes(legacyConsoleWarningToken));
            if (ignorableRequestFailures.length > 0) {
                results.passed.push(`Ignored ${ignorableRequestFailures.length} Cloudflare Insights telemetry DNS failure(s)`);
            }
        } else {
            results.warnings = results.warnings.filter((msg) => !msg.includes(legacyConsoleWarningToken));
            results.warnings.push(`Console/runtime/network issues detected during load: ${loadIssueCount}`);
            if (actionableConsoleErrors.length > 0) console.log('  Console errors:', actionableConsoleErrors);
            if (pageErrors.length > 0) console.log('  Page errors:', pageErrors);
            if (actionableRequestFailures.length > 0) console.log('  Request failures:', actionableRequestFailures);
        }

        // Test 2: Page title and meta description
        console.log('\nTest 2: Checking page title and meta...');
        const title = await page.title();
        const expectedTitle = 'Compare Australian Home Loan Rates - Daily CDR Data | AustralianRates';
        
        if (title === expectedTitle) {
            results.passed.push(`✓ Page title correct: "${title}"`);
        } else {
            results.failed.push(`✗ Page title incorrect. Expected: "${expectedTitle}", Got: "${title}"`);
        }
        const metaDesc = await page.locator('meta[name="description"]').getAttribute('content');
        if (metaDesc && metaDesc.includes('Compare home loan')) {
            results.passed.push('✓ Meta description present and relevant');
        } else {
            results.warnings.push('⚠ Meta description missing or unexpected');
        }
        
        // Test 3: Hero section elements
        console.log('\nTest 3: Checking hero section...');
        
        // Eyebrow text
        const eyebrow = await page.textContent('.eyebrow');
        if (eyebrow === 'Australian Home Loan Rate Tracker') {
            results.passed.push('✓ Hero eyebrow text correct');
        } else {
            results.failed.push(`✗ Hero eyebrow text incorrect: "${eyebrow}"`);
        }
        
        // Heading
        const heading = await page.textContent('.hero h1');
        if (heading === 'Compare mortgage rates from major banks') {
            results.passed.push('✓ Hero heading correct');
        } else {
            results.failed.push(`✗ Hero heading incorrect: "${heading}"`);
        }
        
        // Hero stats
        const statUpdated = await page.textContent('#stat-updated');
        const statCashRate = await page.textContent('#stat-cash-rate');
        const statRecords = await page.textContent('#stat-records');
        
        console.log('  Hero stats values:');
        console.log(`    - ${statUpdated}`);
        console.log(`    - ${statCashRate}`);
        console.log(`    - ${statRecords}`);
        
        if (statUpdated.includes('Last updated:') && !statUpdated.includes('...')) {
            results.passed.push(`✓ Last updated stat populated: ${statUpdated}`);
        } else {
            results.failed.push('✗ Last updated stat not populated');
        }
        
        if (statCashRate.includes('RBA Cash Rate:') && !statCashRate.includes('...')) {
            results.passed.push(`✓ RBA Cash Rate stat populated: ${statCashRate}`);
        } else {
            if (STRICT_RBA_CASH_RATE) results.failed.push('✗ RBA Cash Rate stat not populated');
            else results.warnings.push('⚠ RBA Cash Rate stat not populated on this environment');
        }
        
        if (statRecords.includes('Records:') && !statRecords.includes('...')) {
            results.passed.push(`✓ Records stat populated: ${statRecords}`);
        } else {
            results.failed.push('✗ Records stat not populated');
        }
        
        const triggerButtonCount = await page.locator('#trigger-run').count();
        if (triggerButtonCount === 0) {
            results.passed.push('✓ Public trigger button removed from homepage');
        } else {
            results.failed.push('✗ Public trigger button still present on homepage');
        }
        
        await page.screenshot({ 
            path: `${SCREENSHOT_DIR}/02-hero-section.png`,
            clip: { x: 0, y: 0, width: 1920, height: 400 }
        });
        console.log('  Screenshot saved: 02-hero-section.png');
        
        // SEO summary block visibility
        const seoSummary = await page.locator('.seo-summary').first();
        const seoVisible = await seoSummary.isVisible().catch(() => false);
        if (seoVisible) {
            const seoText = await page.textContent('.seo-summary').catch(() => '');
            if (seoText && seoText.includes('Compare variable and fixed')) {
                results.passed.push('✓ SEO summary block visible and has expected content');
            } else {
                results.passed.push('✓ SEO summary block visible');
            }
        } else {
            results.failed.push('✗ SEO summary block not visible');
        }
        
        // Test 4: Header brand
        console.log('\nTest 4: Checking header branding...');
        const brand = await page.textContent('.site-brand');
        if (brand === 'AustralianRates') {
            results.passed.push('✓ Header brand correct: "AustralianRates"');
        } else {
            results.failed.push(`✗ Header brand incorrect: "${brand}"`);
        }

        // Footer deploy status and log controls
        console.log('\nTest 4b: Checking footer deploy status...');
        await verifyFooterDeployStatus('Homepage');

        console.log('\nTest 4c: Checking footer log controls...');
        await verifyFooterLogControls('Homepage');

        console.log('\nTest 4d: Checking client log richness...');
        await verifyClientLogIsRich('Homepage', 5);
        await verifyFooterLegalLinks('Homepage');
        await verifyNoScriptFallback(TEST_URL, 'Homepage', '/api/home-loan-rates');
        await verifyNoPublicAdminSurface('Homepage');

        // Test 5: Tab buttons
        console.log('\nTest 5: Checking tab buttons...');
        
        const tabExplorer = await page.textContent('#tab-explorer');
        const tabPivotVisible = await page.locator('#tab-pivot').isVisible().catch(() => false);
        const tabChartsVisible = await page.locator('#tab-charts').isVisible().catch(() => false);

        if (tabExplorer === 'Rate Explorer') {
            results.passed.push('PASS Rate Explorer tab text is correct');
        } else {
            results.failed.push('FAIL Rate Explorer tab incorrect: "' + tabExplorer + '"');
        }
        if (!tabPivotVisible && !tabChartsVisible) {
            results.passed.push('PASS Pivot/Chart tabs are hidden in consumer mode');
        } else {
            results.failed.push('FAIL Pivot/Chart tabs should be hidden in consumer mode');
        }
        
        // Test 6: Rate Explorer active by default
        console.log('\nTest 6: Checking default active tab...');
        const explorerActive = await page.locator('#tab-explorer').evaluate(el => el.classList.contains('active'));
        const explorerPanelActive = await page.locator('#panel-explorer').evaluate(el => el.classList.contains('active'));
        const explorerPanelVisible = await page.locator('#panel-explorer').evaluate(el => !el.hidden);
        
        if (explorerActive && explorerPanelActive && explorerPanelVisible) {
            results.passed.push('✓ Rate Explorer is the active/default tab');
        } else {
            results.failed.push('✗ Rate Explorer is not the default active tab');
        }
        // Test 6b: Consumer mode defaults and analyst toggle
        console.log('\nTest 6b: Checking consumer/analyst mode toggle...');
        const modeButtonsVisible = await page.locator('#mode-consumer').isVisible().catch(() => false)
            && await page.locator('#mode-analyst').isVisible().catch(() => false);
        if (modeButtonsVisible) {
            results.passed.push('✓ Consumer/Analyst mode buttons are visible');
        } else {
            results.failed.push('✗ Consumer/Analyst mode buttons missing');
        }

        const consumerPressed = await page.getAttribute('#mode-consumer', 'aria-pressed').catch(() => 'false');
        if (consumerPressed === 'true') {
            results.passed.push('✓ Consumer mode is active by default');
        } else {
            results.failed.push('✗ Consumer mode is not active by default');
        }

        const pivotHiddenByDefault = await page.locator('#tab-pivot').isHidden().catch(() => false);
        const chartsHiddenByDefault = await page.locator('#tab-charts').isHidden().catch(() => false);
        if (pivotHiddenByDefault && chartsHiddenByDefault) {
            results.passed.push('✓ Pivot/Chart tabs hidden in consumer mode');
        } else {
            results.failed.push('✗ Pivot/Chart tabs should be hidden in consumer mode');
        }

        await page.click('#mode-analyst');
        await page.waitForTimeout(500);
        const pivotVisibleAnalyst = await page.locator('#tab-pivot').isVisible().catch(() => false);
        const chartsVisibleAnalyst = await page.locator('#tab-charts').isVisible().catch(() => false);
        if (pivotVisibleAnalyst && chartsVisibleAnalyst) {
            results.passed.push('✓ Analyst mode reveals Pivot/Chart tabs');
        } else {
            results.failed.push('✗ Analyst mode did not reveal Pivot/Chart tabs');
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#main-content', { timeout: 10000 });
        const analystPersisted = await page.getAttribute('#mode-analyst', 'aria-pressed').catch(() => 'false');
        if (analystPersisted === 'true') {
            results.passed.push('✓ Analyst mode selection persists across reload');
        } else {
            results.failed.push('✗ Analyst mode did not persist across reload');
        }

        await page.click('#mode-consumer');
        await page.waitForTimeout(300);
        // Test 7: Filter bar dropdowns
        console.log('\nTest 7: Checking filter bar...');
        
        const filterElements = [
            { id: '#filter-bank', name: 'Bank' },
            { id: '#filter-security', name: 'Purpose' },
            { id: '#filter-repayment', name: 'Repayment' },
            { id: '#filter-structure', name: 'Structure' },
            { id: '#filter-start-date', name: 'From date' },
            { id: '#filter-end-date', name: 'To date' }
        ];
        
        let allFiltersVisible = true;
        for (const filter of filterElements) {
            const visible = await page.locator(filter.id).isVisible();
            if (visible) {
                console.log(`  ✓ ${filter.name} filter visible`);
            } else {
                console.log(`  ✗ ${filter.name} filter not found`);
                allFiltersVisible = false;
            }
        }
        
        if (allFiltersVisible) {
            results.passed.push('✓ Consumer-mode key filters visible');
        } else {
            results.failed.push('✗ Some filter dropdowns missing');
        }

        const lvrHidden = await page.locator('#filter-lvr').isHidden().catch(() => false);
        const featureHidden = await page.locator('#filter-feature').isHidden().catch(() => false);
        if (lvrHidden && featureHidden) {
            results.passed.push('✓ Advanced filters hidden in consumer mode');
        } else {
            results.failed.push('✗ Advanced filters should be hidden in consumer mode');
        }

        // Check checkbox and buttons
        const includeManualVisible = await page.locator('#filter-include-manual').isVisible();
        const autoRefreshVisible = await page.locator('#refresh-interval').isVisible();
        const applyFiltersVisible = await page.locator('#apply-filters').isVisible();
        const downloadFormatVisible = await page.locator('#download-format').isVisible();
        
        if (!includeManualVisible) {
            results.passed.push('✓ "Include manual runs" checkbox hidden in consumer mode');
        } else {
            results.failed.push('✗ "Include manual runs" checkbox should be hidden in consumer mode');
        }
        
        if (!autoRefreshVisible) {
            results.passed.push('✓ Auto-refresh selector hidden in consumer mode');
        } else {
            results.failed.push('✗ Auto-refresh selector should be hidden in consumer mode');
        }
        
        if (applyFiltersVisible) {
            results.passed.push('✓ "Apply Filters" button visible');
        } else {
            results.failed.push('✗ "Apply Filters" button not found');
        }
        
        if (downloadFormatVisible) {
            results.passed.push('✓ Download format select visible');
            const downloadOptions = await page.locator('#download-format option').allTextContents();
            const hasCsv = downloadOptions.some(t => t.trim() === 'CSV');
            const hasXls = downloadOptions.some(t => t.trim() === 'XLS');
            const hasJson = downloadOptions.some(t => t.trim() === 'JSON');
            if (hasCsv && hasXls && hasJson) {
                results.passed.push('✓ Download select has CSV, XLS, JSON options');
            } else {
                results.failed.push(`✗ Download select missing options (CSV:${hasCsv} XLS:${hasXls} JSON:${hasJson})`);
            }
        } else {
            results.failed.push('✗ Download format select (#download-format) not found');
        }
        
        await page.screenshot({ 
            path: `${SCREENSHOT_DIR}/03-filter-bar.png`,
            clip: { x: 0, y: 350, width: 1920, height: 300 }
        });
        console.log('  Screenshot saved: 03-filter-bar.png');
        
        // Test 8: Check Bank dropdown options
        console.log('\nTest 8: Checking Bank dropdown options...');
        
        // Wait for filters to load
        await page.waitForTimeout(2000);
        
        const bankOptions = await page.locator('#filter-bank option').allTextContents();
        console.log(`  Found ${bankOptions.length} bank options:`, bankOptions);
        
        if (bankOptions.length > 1) { // More than just "All"
            results.passed.push(`✓ Bank dropdown populated with ${bankOptions.length} options`);
            
            // Click to open dropdown (visual test)
            await page.click('#filter-bank');
            await page.waitForTimeout(500);
            await page.screenshot({ 
                path: `${SCREENSHOT_DIR}/04-bank-dropdown-open.png`
            });
            console.log('  Screenshot saved: 04-bank-dropdown-open.png');
        } else {
            results.failed.push('✗ Bank dropdown not populated with options');
        }
        
        // Test 9: Check Rate Explorer table
        console.log('\nTest 9: Checking Rate Explorer table data...');
        await page.click('#mode-analyst');
        await page.waitForTimeout(700);
        
        await page.waitForTimeout(3000); // Wait for table to load
        
        const tableExists = await page.locator('#rate-table').isVisible();
        if (tableExists) {
            results.passed.push('✓ Rate Explorer table element exists');
        } else {
            results.failed.push('✗ Rate Explorer table element not found');
        }
        
        // Check for Tabulator table: either .tabulator wrapper or data rows present (Tabulator 6 structure may vary)
        const tabulatorExists = await page.locator('#rate-table .tabulator').isVisible();
        const tableRows = await page.locator('#rate-table .tabulator-row').count();
        if (tableRows > 0) {
            results.passed.push('✓ Rate Explorer table loaded with data');
        } else if (tabulatorExists) {
            results.passed.push('✓ Tabulator table initialized');
        } else {
            results.failed.push('✗ Tabulator table not initialized and no data rows');
        }
        
        // Check for table rows
        console.log(`  Found ${tableRows} rows in Rate Explorer table`);
        
        if (tableRows > 0) {
            results.passed.push(`✓ Rate Explorer table loaded with ${tableRows} data rows`);
            
            // Get sample data from first row
            const firstRowCells = await page.locator('#rate-table .tabulator-row').first().locator('.tabulator-cell').allTextContents();
            console.log('  Sample first row data:', firstRowCells.slice(0, 5));
        } else {
            results.failed.push('✗ Rate Explorer table has no data rows');
        }

        const explorerHeaders = await page.locator('#rate-table .tabulator-col-title').allTextContents().catch(() => []);
        verifyMetadataHeaders(explorerHeaders, 'Rate Explorer');

        const settingsBtn = page.locator('#table-settings-btn');
        const settingsBtnVisible = await settingsBtn.isVisible().catch(() => false);
        if (settingsBtnVisible) {
            results.passed.push('PASS Rate Explorer: settings icon is visible');
            let includeRemovedRequested = false;
            const onRatesRequest = (req) => {
                const url = req.url();
                if (url.includes('/rates?') && url.includes('include_removed=true')) {
                    includeRemovedRequested = true;
                }
            };
            context.on('request', onRatesRequest);
            await settingsBtn.click();
            await page.waitForTimeout(300);
            const popoverVisible = await page.locator('#table-settings-popover').isVisible().catch(() => false);
            if (popoverVisible) {
                results.passed.push('PASS Rate Explorer: settings popover opens');
                const showRemovedToggle = page.locator('#table-settings-popover input[data-setting=\"show-removed\"]');
                if (await showRemovedToggle.isVisible().catch(() => false)) {
                    const isChecked = await showRemovedToggle.isChecked().catch(() => false);
                    if (!isChecked) {
                        await showRemovedToggle.click();
                        await page.waitForTimeout(1600);
                    }
                    if (includeRemovedRequested) {
                        results.passed.push('PASS Rate Explorer: show removed toggle requests include_removed=true');
                    } else {
                        if (STRICT_NEW_EXPLORER_COLUMNS) results.failed.push('FAIL Rate Explorer: show removed toggle did not request include_removed=true');
                        else results.warnings.push('WARN Rate Explorer: show removed toggle did not request include_removed=true on this environment');
                    }
                    const removedRowsRendered = await page.locator('#rate-table .tabulator-row.ar-row-removed').count();
                    if (removedRowsRendered > 0) {
                        results.passed.push(`PASS Rate Explorer: removed rows render with strike-through class (${removedRowsRendered})`);
                    } else {
                        results.warnings.push('WARN Rate Explorer: no removed rows found in current dataset after toggling show removed');
                    }
                } else {
                    if (STRICT_NEW_EXPLORER_COLUMNS) results.failed.push('FAIL Rate Explorer: show removed toggle not found in settings popover');
                    else results.warnings.push('WARN Rate Explorer: show removed toggle not found in settings popover on this environment');
                }
            } else {
                if (STRICT_NEW_EXPLORER_COLUMNS) results.failed.push('FAIL Rate Explorer: settings popover did not open');
                else results.warnings.push('WARN Rate Explorer: settings popover did not open on this environment');
            }
            context.off('request', onRatesRequest);
            await page.keyboard.press('Escape').catch(() => {});
        } else {
            if (STRICT_NEW_EXPLORER_COLUMNS) results.failed.push('FAIL Rate Explorer: settings icon not found');
            else results.warnings.push('WARN Rate Explorer: settings icon not found on this environment');
        }
        
        await page.screenshot({ 
            path: `${SCREENSHOT_DIR}/05-rate-explorer-table.png`,
            fullPage: false
        });
        console.log('  Screenshot saved: 05-rate-explorer-table.png');
        
        // Test 9b: Column sort - click a sortable header and ensure table re-sorts
        if (tableRows > 0) {
            console.log('  Testing column sort (click Bank header)...');
            const bankHeader = page.locator('#rate-table .tabulator-col').filter({ hasText: 'Bank' }).first();
            if (await bankHeader.isVisible().catch(() => false)) {
                const readTopBanks = async (maxRows) => {
                    const bankColumnIndex = await page.evaluate(() => {
                        const columns = Array.from(document.querySelectorAll('#rate-table .tabulator-col'));
                        for (let i = 0; i < columns.length; i++) {
                            const title = String(columns[i].querySelector('.tabulator-col-title')?.textContent || '').trim();
                            if (title === 'Bank') return i;
                        }
                        return -1;
                    });
                    if (bankColumnIndex < 0) return [];
                    const rowsLocator = page.locator('#rate-table .tabulator-row');
                    const count = Math.min(await rowsLocator.count(), maxRows);
                    const banks = [];
                    for (let i = 0; i < count; i++) {
                        const bank = await rowsLocator.nth(i).locator('.tabulator-cell').nth(bankColumnIndex).textContent().catch(() => '');
                        banks.push(String(bank || '').trim());
                    }
                    return banks;
                };

                const topBanksBefore = await readTopBanks(5);
                await bankHeader.click();
                await page.waitForTimeout(1200);
                const topBanksAfterFirstClick = await readTopBanks(5);
                await bankHeader.click();
                await page.waitForTimeout(1200);
                const topBanksAfterSecondClick = await readTopBanks(5);
                const rowsAfterSort = await page.locator('#rate-table .tabulator-row').count();
                if (rowsAfterSort > 0) {
                    results.passed.push('Column sort (Bank) works - table still has data');
                } else {
                    results.failed.push('After clicking sort, table has no rows');
                }

                const seqBefore = JSON.stringify(topBanksBefore);
                const seqAfterFirst = JSON.stringify(topBanksAfterFirstClick);
                const seqAfterSecond = JSON.stringify(topBanksAfterSecondClick);
                const sortChangedOrder = seqBefore !== seqAfterFirst || seqBefore !== seqAfterSecond;
                if (sortChangedOrder) {
                    results.passed.push('Column sort (Bank) changed visible row order');
                } else {
                    results.warnings.push('Column sort: top rows unchanged after toggling sort twice (dataset may already match order)');
                }
            } else {
                results.warnings.push('⚠ Sort test skipped: Bank column header not found');
            }
        }
        
        // Test 10: Check disclaimer
        console.log('\nTest 10: Checking disclaimer text...');
        
        const disclaimer = await page.textContent('.disclaimer');
        if (disclaimer && disclaimer.includes('This site provides general information only')) {
            results.passed.push('✓ Disclaimer text present at bottom of page');
            console.log(`  Disclaimer: ${disclaimer.substring(0, 100)}...`);
        } else {
            results.failed.push('✗ Disclaimer text not found or incorrect');
        }

        const comparisonDisclosure = await page.textContent('#comparison-rate-disclosure').catch(() => '');
        if (comparisonDisclosure && comparisonDisclosure.includes('$150,000') && comparisonDisclosure.toLowerCase().includes('25 year')) {
            results.passed.push('✓ Home-loan comparison-rate disclosure is visible');
        } else {
            results.failed.push('✗ Home-loan comparison-rate disclosure missing or incomplete');
        }
        
        // Test 10b: Accessibility - skip link and tab semantics
        console.log('\nTest 10b: Accessibility (skip link, tab roles)...');
        const skipLink = await page.locator('a.skip-link[href="#main-content"]');
        const skipVisible = await skipLink.isVisible().catch(() => false);
        if (skipVisible) {
            results.passed.push('✓ Skip to content link present and targets #main-content');
        } else {
            results.warnings.push('⚠ Skip link not found or wrong href');
        }
        const tablistRole = await page.locator('[role="tablist"]').count();
        const tabRole = await page.locator('[role="tab"]').count();
        const tabpanelRole = await page.locator('[role="tabpanel"]').count();
        if (tablistRole >= 1 && tabRole >= 3 && tabpanelRole >= 3) {
            results.passed.push('✓ Tab list and panels have correct ARIA roles');
        } else {
            results.warnings.push(`⚠ ARIA roles: tablist=${tablistRole} tab=${tabRole} tabpanel=${tabpanelRole}`);
        }
        
        // Test 10c: Skip link click - focus moves to main content (skip link may be off-screen for a11y)
        console.log('\nTest 10c: Skip link interaction...');
        await page.evaluate(() => {
            const skip = document.querySelector('a.skip-link[href="#main-content"]');
            if (skip) skip.click();
        });
        await page.waitForTimeout(200);
        const focusInMain = await page.evaluate(() => {
            const main = document.getElementById('main-content');
            return main && main.contains(document.activeElement);
        });
        if (focusInMain) {
            results.passed.push('✓ Skip link moves focus to main content');
        } else {
            results.warnings.push('⚠ Skip link may not move focus to #main-content');
        }
        
        // Test 10d: Tab switching - each tab shows correct panel
        console.log('\nTest 10d: Tab switching...');
        await page.click('#tab-pivot');
        await page.waitForTimeout(300);
        const pivotPanelVisible = await page.locator('#panel-pivot').evaluate(el => !el.hidden);
        const pivotTabActive = await page.locator('#tab-pivot').evaluate(el => el.classList.contains('active'));
        if (pivotPanelVisible && pivotTabActive) {
            results.passed.push('✓ Pivot tab shows Pivot panel');
        } else {
            results.failed.push('✗ Pivot tab did not show Pivot panel');
        }
        await page.click('#tab-charts');
        await page.waitForTimeout(300);
        const chartsPanelVisible = await page.locator('#panel-charts').evaluate(el => !el.hidden);
        const chartsTabActive = await page.locator('#tab-charts').evaluate(el => el.classList.contains('active'));
        if (chartsPanelVisible && chartsTabActive) {
            results.passed.push('✓ Chart Builder tab shows Chart panel');
        } else {
            results.failed.push('✗ Chart Builder tab did not show Chart panel');
        }
        await page.click('#tab-explorer');
        await page.waitForTimeout(300);
        const explorerPanelVisibleAfterTab = await page.locator('#panel-explorer').evaluate(el => !el.hidden);
        if (explorerPanelVisibleAfterTab) {
            results.passed.push('✓ Rate Explorer tab shows Explorer panel');
        } else {
            results.failed.push('✗ Rate Explorer tab did not show Explorer panel');
        }
        
        // Test 10e: Apply Filters - table reloads (wait for network/table update)
        console.log('\nTest 10e: Apply Filters...');
        await page.click('#apply-filters');
        await page.waitForTimeout(2000);
        const tableStillHasRows = await page.locator('#rate-table .tabulator-row').count() > 0;
        if (tableStillHasRows) {
            results.passed.push('✓ Apply Filters runs and table still has data');
        } else {
            results.warnings.push('⚠ After Apply Filters, table may have no rows (could be empty data)');
        }
        
        // Test 10f: Load Data for Pivot
        console.log('\nTest 10f: Load Data for Pivot...');
        await page.click('#tab-pivot');
        await page.waitForTimeout(500);
        await page.click('#load-pivot');
        await page.waitForTimeout(5000);
        const pivotHasContent = await page.locator('#pivot-output').evaluate(el => el.children.length > 0 || el.textContent.trim().length > 0);
        if (pivotHasContent) {
            results.passed.push('✓ Load Data for Pivot populates pivot output');
        } else {
            results.warnings.push('⚠ Pivot output empty after Load (may need filters or data)');
        }
        
        // Test 10g: Draw Chart
        console.log('\nTest 10g: Draw Chart...');
        await page.click('#tab-charts');
        await page.waitForTimeout(500);
        await page.click('#draw-chart');
        await page.waitForTimeout(5000);
        const chartHasContent = await page.locator('#chart-output').evaluate(el => el.children.length > 0 || el.querySelector('.plotly'));
        if (chartHasContent) {
            results.passed.push('✓ Draw Chart populates chart output');
        } else {
            results.warnings.push('⚠ Chart output empty after Draw (may need data)');
        }
        
        // Test 10h: Download (export) - select CSV triggers request
        console.log('\nTest 10h: Download (export) flow...');
        await page.click('#tab-explorer');
        await page.waitForTimeout(500);
        let exportRequested = false;
        const onExportRequest = (req) => {
            const u = req.url();
            if (u.includes('/export') || u.includes('export.csv')) exportRequested = true;
        };
        context.on('request', onExportRequest);
        await page.selectOption('#download-format', 'csv');
        await page.waitForTimeout(3000);
        context.off('request', onExportRequest);
        if (exportRequested) {
            results.passed.push('✓ Download format CSV triggers export request');
        } else {
            results.warnings.push('⚠ Export request not detected (download may use blob)');
        }
        await page.evaluate(() => {
            const el = document.getElementById('download-format');
            if (el) el.value = '';
        });
        
        // Test 10i: Section parity checks (Savings + Term deposits)
        const savingsUrl = withSharedQuery('/savings/');
        const termDepositsUrl = withSharedQuery('/term-deposits/');
        for (const { name, url, apiBasePath } of [
            { name: 'Savings', url: savingsUrl, apiBasePath: '/api/savings-rates' },
            { name: 'Term deposits', url: termDepositsUrl, apiBasePath: '/api/term-deposit-rates' },
        ]) {
            console.log('\nTest 10i: Section checks for ' + name + '...');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForSelector('#main-content', { timeout: 8000 });
            await page.waitForTimeout(1500);
            await verifyFooterDeployStatus(name);
            await verifyFooterLogControls(name);
            await verifyFooterLegalLinks(name);
            await verifyNoScriptFallback(url, name, apiBasePath);
            await verifyNoPublicAdminSurface(name);

            const hasTrigger = await page.locator('#trigger-run').count();
            if (hasTrigger === 0) {
                results.passed.push('PASS ' + name + ': public trigger button removed');
            } else {
                results.failed.push('FAIL ' + name + ': public trigger button still present');
            }

            const sectionHeaders = await page.locator('#rate-table .tabulator-col-title').allTextContents().catch(() => []);
            verifyMetadataHeaders(sectionHeaders, name);
        }
        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#main-content', { timeout: 5000 });
        await page.waitForTimeout(1000);
        // Test 10j: URL state - tab and params sync
        console.log('\nTest 10j: URL state sync...');
        await page.click('#mode-analyst');
        await page.waitForTimeout(400);
        await page.click('#tab-pivot');
        await page.waitForTimeout(500);
        const urlAfterTab = await page.url();
        if (urlAfterTab.includes('tab=pivot')) {
            results.passed.push('✓ URL contains tab=pivot after switching to Pivot');
        } else {
            results.failed.push('✗ URL does not contain tab=pivot');
        }
        
        // Test 10k: URL state restoration - load with ?tab=pivot
        const urlWithTab = (TEST_URL.includes('?') ? TEST_URL + '&tab=pivot' : TEST_URL.replace(/\/?$/, '') + '?tab=pivot');
        await page.goto(urlWithTab, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#panel-pivot', { timeout: 5000 });
        await page.waitForTimeout(2000);
        const pivotRestored = await page.locator('#panel-pivot').evaluate(el => !el.hidden);
        const pivotTabActiveRestored = await page.locator('#tab-pivot').evaluate(el => el.classList.contains('active'));
        if (pivotRestored && pivotTabActiveRestored) {
            results.passed.push('✓ URL ?tab=pivot restores Pivot tab on load');
        } else {
            results.failed.push('✗ URL ?tab=pivot did not restore Pivot tab');
        }

        // Test 10l: Shared link - view=analyst&tab=pivot restores analyst mode and Pivot tab (no reliance on localStorage)
        console.log('\nTest 10l: URL view=analyst&tab=pivot (shared link)...');
        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#main-content', { timeout: 5000 });
        await page.click('#mode-consumer').catch(() => {});
        await page.waitForTimeout(300);
        const baseForView = (TEST_URL.includes('?') ? TEST_URL + '&' : TEST_URL.replace(/\/?$/, '') + '?');
        const urlViewAnalystTabPivot = baseForView + 'view=analyst&tab=pivot';
        await page.goto(urlViewAnalystTabPivot, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#panel-pivot', { timeout: 8000 });
        await page.waitForTimeout(1500);
        const analystFromUrl = await page.locator('#panel-pivot').evaluate(el => !el.hidden);
        const pivotTabActiveFromUrl = await page.locator('#tab-pivot').evaluate(el => el.classList.contains('active'));
        const analystBtnActive = await page.locator('#mode-analyst').evaluate(el => el.classList.contains('active'));
        if (analystFromUrl && pivotTabActiveFromUrl && analystBtnActive) {
            results.passed.push('✓ URL ?view=analyst&tab=pivot restores analyst mode and Pivot tab (shared link)');
        } else {
            results.failed.push('✗ URL ?view=analyst&tab=pivot did not restore analyst mode and Pivot tab');
        }

        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#main-content', { timeout: 5000 });
        await page.waitForTimeout(1500);
        
        // Test 11: Responsive design and viewport overflow
        console.log('\nTest 11: Testing responsive design and viewports...');
        
        const viewports = [
            { w: 375, h: 667, name: 'mobile' },
            { w: 768, h: 1024, name: 'tablet' },
            { w: 1920, h: 1080, name: 'desktop' }
        ];
        for (const vp of viewports) {
            await page.setViewportSize({ width: vp.w, height: vp.h });
            await page.waitForTimeout(800);
            const noOverflow = await page.evaluate((w) => document.documentElement.scrollWidth <= w, vp.w);
            if (noOverflow) {
                results.passed.push(`✓ Viewport ${vp.w}x${vp.h} (${vp.name}): no horizontal overflow`);
            } else {
                results.failed.push(`✗ Viewport ${vp.w}x${vp.h}: horizontal overflow (scrollWidth > ${vp.w})`);
            }
        }
        
        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForTimeout(1000);
        await page.screenshot({ 
            path: `${SCREENSHOT_DIR}/06-mobile-view.png`,
            fullPage: true
        });
        console.log('  Screenshot saved: 06-mobile-view.png');
        results.passed.push('✓ Mobile viewport (375x667) rendered');
        
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.waitForTimeout(1000);
        await page.screenshot({ 
            path: `${SCREENSHOT_DIR}/07-tablet-view.png`,
            fullPage: true
        });
        console.log('  Screenshot saved: 07-tablet-view.png');
        results.passed.push('✓ Tablet viewport (768x1024) rendered');
        
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.waitForTimeout(1000);
        
        // Test 12: Pivot and Chart panel elements (visibility when tab switched)
        console.log('\nTest 12: Pivot and Chart panel elements...');
        await page.click('#tab-pivot');
        await page.waitForTimeout(500);
        const loadPivotVisible = await page.locator('#load-pivot').isVisible();
        const pivotOutputExists = await page.locator('#pivot-output').count() > 0;
        if (loadPivotVisible && pivotOutputExists) {
            results.passed.push('✓ Pivot panel: Load Data button and pivot output area present');
        } else {
            results.failed.push('✗ Pivot panel: Load Data button or pivot output not found');
        }
        await page.click('#tab-charts');
        await page.waitForTimeout(500);
        const drawChartVisible = await page.locator('#draw-chart').isVisible();
        const chartOutputVisible = await page.locator('#chart-output').isVisible();
        const chartStatusVisible = await page.locator('#chart-status').isVisible();
        if (drawChartVisible && chartOutputVisible && chartStatusVisible) {
            results.passed.push('✓ Chart panel: Draw Chart, chart output and status visible');
        } else {
            results.failed.push('✗ Chart panel: Draw Chart or chart output/status not visible');
        }
        await page.click('#tab-explorer');
        await page.waitForTimeout(500);

        // Test 13: Legal pages
        console.log('\nTest 13: Legal pages...');
        await verifyLegalPagesDistinct();
        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('#main-content', { timeout: 5000 });
        
    } catch (error) {
        results.failed.push(`✗ Fatal error during testing: ${error.message}`);
        console.error('Error:', error);
        
        // Take error screenshot
        try {
            await page.screenshot({ 
                path: `${SCREENSHOT_DIR}/error-screenshot.png`,
                fullPage: true
            });
        } catch (e) {
            console.error('Could not take error screenshot:', e.message);
        }
    } finally {
        await browser.close();
    }
    
    // Print results
    console.log('\n\n========================================');
    console.log('TEST RESULTS SUMMARY');
    console.log('========================================\n');
    
    console.log(`PASSED: ${results.passed.length} tests`);
    results.passed.forEach(msg => console.log(msg));
    
    if (results.warnings.length > 0) {
        console.log(`\nWARNINGS: ${results.warnings.length}`);
        results.warnings.forEach(msg => console.log(msg));
    }
    
    if (results.failed.length > 0) {
        console.log(`\nFAILED: ${results.failed.length} tests`);
        results.failed.forEach(msg => console.log(msg));
    }
    
    console.log('\n========================================');
    console.log(`Total Tests: ${results.passed.length + results.failed.length}`);
    console.log(`Pass Rate: ${((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1)}%`);
    console.log('========================================\n');
    
    console.log(`Screenshots saved to: ${SCREENSHOT_DIR}/`);
    
    // Exit with appropriate code
    process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
    console.error('Failed to run tests:', error);
    process.exit(1);
});




