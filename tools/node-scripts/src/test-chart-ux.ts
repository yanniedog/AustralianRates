// @ts-nocheck
const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';

function parseRgb(input) {
    const match = String(input || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function brightness(rgb) {
    if (!rgb) return 0;
    return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
}

async function openChartWorkspace(page) {
    await page.waitForSelector('#main-content', { timeout: 15000 });
    await page.click('#mode-analyst');
    await page.waitForTimeout(500);
    await page.click('#tab-charts');
    await page.waitForTimeout(400);
}

async function openFilterBar(page) {
    const bar = page.locator('#filter-bar');
    const open = await bar.evaluate((el) => !!el.open).catch(() => false);
    if (open) return;
    await page.locator('#filter-bar > summary').click().catch(() => {});
    await page.waitForTimeout(250);
}

async function configureHomeLoanSlice(page) {
    await openFilterBar(page);
    await page.selectOption('#filter-security', 'owner_occupied').catch(() => {});
    await page.selectOption('#filter-repayment', 'principal_and_interest').catch(() => {});
    await page.selectOption('#filter-lvr', 'lvr_80-85%').catch(() => {});
    await page.click('#apply-filters');
    await page.waitForTimeout(2000);
}

async function drawChart(page) {
    await page.click('#draw-chart');
    await page.waitForFunction(() => {
        const output = document.getElementById('chart-output');
        return !!output && (
            output.getAttribute('data-chart-engine') === 'echarts' ||
            !!output.querySelector('canvas') ||
            !!output.querySelector('svg')
        );
    }, { timeout: 30000 });
    await page.waitForTimeout(1200);
}

async function inspectWorkspace(page) {
    return await page.evaluate(() => {
        const shell = document.querySelector('#panel-charts .chart-shell');
        const stage = document.querySelector('#panel-charts .chart-main-stage');
        const rail = document.querySelector('#panel-charts .chart-series-rail');
        const output = document.getElementById('chart-output');
        const title = document.querySelector('#panel-charts .chart-hero-copy h2');
        const guidance = document.getElementById('chart-guidance');
        const summary = document.getElementById('chart-summary');
        const lendersButton = document.querySelector('[data-chart-view="lenders"]');
        const note = document.getElementById('chart-series-note');
        const titleColor = title ? window.getComputedStyle(title).color : '';
        const guidanceColor = guidance ? window.getComputedStyle(guidance).color : '';
        const outputStyle = output ? window.getComputedStyle(output) : null;
        const shellRect = shell ? shell.getBoundingClientRect() : null;
        const stageRect = stage ? stage.getBoundingClientRect() : null;
        const railRect = rail ? rail.getBoundingClientRect() : null;
        return {
            view: output ? output.getAttribute('data-chart-view') : '',
            summaryText: summary ? String(summary.textContent || '') : '',
            noteText: note ? String(note.textContent || '') : '',
            shellFits: !!(shell && shell.scrollWidth <= shell.clientWidth + 1),
            stageHeight: stageRect ? stageRect.height : 0,
            railHeight: railRect ? railRect.height : 0,
            titleColor,
            guidanceColor,
            outputHasGradient: !!(outputStyle && /gradient/i.test(String(outputStyle.backgroundImage || ''))),
            outputBackgroundColor: outputStyle ? String(outputStyle.backgroundColor || '') : '',
            lendersButtonVisible: !!(lendersButton && !lendersButton.hasAttribute('hidden')),
            shellWidth: shellRect ? shellRect.width : 0,
        };
    });
}

async function verifyChartWorkspace(page, label, options) {
    const failures = [];
    const info = await inspectWorkspace(page);
    if (info.view !== options.expectedView) failures.push(`${label}: expected ${options.expectedView} view, got ${info.view || 'none'}`);
    if (!info.shellFits) failures.push(`${label}: chart shell has horizontal overflow`);
    if (!info.outputHasGradient && /255,\s*255,\s*255/.test(info.outputBackgroundColor)) {
        failures.push(`${label}: chart output background fell back to white`);
    }
    if (brightness(parseRgb(info.titleColor)) < 170) failures.push(`${label}: chart title contrast is too low`);
    if (brightness(parseRgb(info.guidanceColor)) < 140) failures.push(`${label}: chart guidance contrast is too low`);
    if (options.expectLendersButton && !info.lendersButtonVisible) failures.push(`${label}: lenders view button is not visible`);
    if (options.expectSliceText) {
        const summary = info.summaryText.toLowerCase();
        const missing = options.expectSliceText.filter((text) => !summary.includes(String(text).toLowerCase()));
        if (missing.length) failures.push(`${label}: summary is missing slice pills for ${missing.join(', ')}`);
    }
    if (options.expectRailFit && Math.abs(info.stageHeight - info.railHeight) > 180) {
        failures.push(`${label}: chart rail height drifted too far from the main chart frame`);
    }
    if (options.expectNote && !String(info.noteText || '').toLowerCase().includes(String(options.expectNote).toLowerCase())) {
        failures.push(`${label}: rail note did not mention "${options.expectNote}"`);
    }
    return failures;
}

async function verifyCachedViewSwitch(page, label, view) {
    let requestCount = 0;
    const handler = (req) => {
        if (String(req.url() || '').includes('/rates?')) requestCount += 1;
    };
    page.context().on('request', handler);
    await page.click(`[data-chart-view="${view}"]`);
    await page.waitForTimeout(1200);
    page.context().off('request', handler);
    const currentView = await page.locator('#chart-output').evaluate((el) => el.getAttribute('data-chart-view')).catch(() => '');
    if (currentView !== view) return `${label}: failed to switch to ${view} view`;
    if (requestCount !== 0) return `${label}: switching to ${view} triggered ${requestCount} unexpected /rates fetches`;
    return null;
}

async function verifySection(page, section) {
    const failures = [];
    await page.goto(section.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await openChartWorkspace(page);
    if (section.configure) {
        await section.configure(page);
        await page.click('#tab-charts');
        await page.waitForTimeout(350);
    }
    await drawChart(page);
    failures.push(...await verifyChartWorkspace(page, `${section.name} lenders`, {
        expectedView: 'lenders',
        expectLendersButton: true,
        expectSliceText: section.expectedSliceText || [],
        expectRailFit: true,
        expectNote: 'lender',
    }));
    const surfaceSwitch = await verifyCachedViewSwitch(page, section.name, 'surface');
    if (surfaceSwitch) failures.push(surfaceSwitch);
    failures.push(...await verifyChartWorkspace(page, `${section.name} surface`, {
        expectedView: 'surface',
        expectLendersButton: true,
        expectSliceText: section.expectedSliceText || [],
        expectRailFit: true,
        expectNote: 'click',
    }));
    const compareSwitch = await verifyCachedViewSwitch(page, section.name, 'compare');
    if (compareSwitch) failures.push(compareSwitch);
    return failures;
}

async function verifyMobile(url) {
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
    const page = await browser.newPage({ viewport: { width: 390, height: 1100 } });
    const failures = [];
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await openChartWorkspace(page);
        await configureHomeLoanSlice(page);
        await page.click('#tab-charts');
        await page.waitForTimeout(350);
        await drawChart(page);
        await page.click('[data-chart-view="lenders"]');
        await page.waitForTimeout(900);
        const mobile = await page.evaluate(() => {
            const panel = document.querySelector('#panel-charts');
            const shell = document.querySelector('#panel-charts .chart-shell');
            const output = document.getElementById('chart-output');
            const rail = document.querySelector('#panel-charts .chart-series-rail');
            return {
                pageFits: document.documentElement.scrollWidth <= window.innerWidth,
                shellFits: !!(shell && shell.scrollWidth <= shell.clientWidth + 1),
                outputWidth: output ? output.getBoundingClientRect().width : 0,
                railWidth: rail ? rail.getBoundingClientRect().width : 0,
                panelVisible: !!(panel && !panel.hasAttribute('hidden')),
            };
        });
        if (!mobile.panelVisible) failures.push('Mobile: chart panel is not visible');
        if (!mobile.pageFits) failures.push('Mobile: page has horizontal overflow');
        if (!mobile.shellFits) failures.push('Mobile: chart shell has horizontal overflow');
        if (mobile.outputWidth < 260) failures.push(`Mobile: chart output is too narrow (${mobile.outputWidth}px)`);
        if (mobile.railWidth < 260) failures.push(`Mobile: chart rail is too narrow (${mobile.railWidth}px)`);
    } finally {
        await browser.close();
    }
    return failures;
}

async function main() {
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const failures = [];
    const sections = [
        {
            name: 'Home loans',
            url: TEST_URL,
            configure: configureHomeLoanSlice,
            expectedSliceText: ['owner', 'principal', '80-85'],
        },
        { name: 'Savings', url: new URL('/savings/', TEST_URL).toString() },
        { name: 'Term deposits', url: new URL('/term-deposits/', TEST_URL).toString() },
    ];

    try {
        for (const section of sections) {
            failures.push(...await verifySection(page, section));
        }
    } finally {
        await browser.close();
    }

    failures.push(...await verifyMobile(TEST_URL));

    if (failures.length) {
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
