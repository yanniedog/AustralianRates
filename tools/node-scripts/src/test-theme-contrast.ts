// @ts-nocheck
const { chromium } = require('playwright');

const TEST_URL = process.env.TEST_URL || 'https://www.australianrates.com/';
const testUrlObj = new URL(TEST_URL);
const baseOrigin = testUrlObj.origin;
const sharedParams = new URLSearchParams(testUrlObj.search || '');
const VIEWPORT = { width: 1440, height: 1200 };
const THEMES = ['dark', 'light'];
const ROUTES = [
    { kind: 'public', name: 'Home loans', path: '/', apiBasePath: '/api/home-loan-rates' },
    { kind: 'public', name: 'Savings', path: '/savings/', apiBasePath: '/api/savings-rates' },
    { kind: 'public', name: 'Term deposits', path: '/term-deposits/', apiBasePath: '/api/term-deposit-rates' },
    { kind: 'legal', name: 'About', path: '/about/' },
    { kind: 'legal', name: 'Contact', path: '/contact/' },
    { kind: 'legal', name: 'Privacy', path: '/privacy/' },
    { kind: 'legal', name: 'Terms', path: '/terms/' },
    { kind: 'admin-login', name: 'Admin login', path: '/admin/index.html' },
];

function withSharedQuery(path, apiBasePath) {
    const params = new URLSearchParams(sharedParams.toString());
    if (apiBasePath && params.has('apiBase')) {
        const currentApiBase = params.get('apiBase');
        try {
            const parsedApiBase = new URL(String(currentApiBase || ''));
            parsedApiBase.pathname = apiBasePath;
            params.set('apiBase', parsedApiBase.toString());
        } catch (_) {}
    }
    const query = params.toString();
    return baseOrigin + path + (query ? ('?' + query) : '');
}

async function gotoRoute(page, route) {
    await page.goto(withSharedQuery(route.path, route.apiBasePath), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    await page.waitForSelector('#main-content', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(route.kind === 'public' ? 2500 : 1200);
}

async function setTheme(page, theme) {
    await page.evaluate(async (nextTheme) => {
        if (window.ARTheme && typeof window.ARTheme.setTheme === 'function') {
            window.ARTheme.setTheme(nextTheme);
        } else {
            document.documentElement.setAttribute('data-theme', nextTheme);
            document.documentElement.style.colorScheme = nextTheme;
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, theme);
    await page.waitForTimeout(120);
}

async function openIfPresent(page, selector) {
    const details = page.locator(selector).first();
    if (!(await details.count().catch(() => 0))) return;
    const isOpen = await details.evaluate((node) => node instanceof HTMLDetailsElement && node.open).catch(() => false);
    if (!isOpen) {
        await page.locator(`${selector} > summary`).click().catch(() => undefined);
        await page.waitForTimeout(250);
    }
}

async function prepareRoute(page, route) {
    await openIfPresent(page, '#market-notes');
    await openIfPresent(page, '#footer-technical');
    if (route.kind !== 'public') return;
    await openIfPresent(page, '#scenario');
    await page.locator('#tab-history').click().catch(() => undefined);
    await page.waitForTimeout(250);
    await page.locator('#tab-changes').click().catch(() => undefined);
    await page.waitForTimeout(250);
    await page.locator('#tab-explorer').click().catch(() => undefined);
    await page.waitForTimeout(250);
}

async function collectContrast(page) {
    return await page.evaluate(`(() => {
        function parseColor(value) {
            const text = String(value || '').trim();
            if (!text) return { r: 0, g: 0, b: 0, a: 0 };
            const match = text.match(/^rgba?\\(([^)]+)\\)$/i);
            if (!match) return { r: 0, g: 0, b: 0, a: 0 };
            const parts = match[1].split(',').map((part) => Number(String(part).trim()));
            return {
                r: Number.isFinite(parts[0]) ? parts[0] : 0,
                g: Number.isFinite(parts[1]) ? parts[1] : 0,
                b: Number.isFinite(parts[2]) ? parts[2] : 0,
                a: Number.isFinite(parts[3]) ? parts[3] : 1,
            };
        }
        function composite(over, under) {
            const alpha = over.a + under.a * (1 - over.a);
            if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
            return {
                r: ((over.r * over.a) + (under.r * under.a * (1 - over.a))) / alpha,
                g: ((over.g * over.a) + (under.g * under.a * (1 - over.a))) / alpha,
                b: ((over.b * over.a) + (under.b * under.a * (1 - over.a))) / alpha,
                a: alpha,
            };
        }
        function channel(value) {
            const normalized = value / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        }
        function luminance(color) {
            return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
        }
        function contrastRatio(foreground, background) {
            const light = Math.max(luminance(foreground), luminance(background));
            const dark = Math.min(luminance(foreground), luminance(background));
            return (light + 0.05) / (dark + 0.05);
        }
        function isVisible(node) {
            if (!node) return false;
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }
        function intersectsViewport(rects) {
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            return rects.some((rect) => rect.width > 0 && rect.height > 0 &&
                rect.right > 0 &&
                rect.bottom > 0 &&
                rect.left < viewportWidth &&
                rect.top < viewportHeight);
        }
        function backgroundFor(node) {
            const pageBase = parseColor(window.getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)');
            let current = node;
            let background = { r: pageBase.r, g: pageBase.g, b: pageBase.b, a: pageBase.a || 1 };
            while (current) {
                const style = window.getComputedStyle(current);
                const bg = parseColor(style.backgroundColor);
                if (bg.a > 0) {
                    background = composite(bg, background);
                    if (background.a >= 0.99) break;
                }
                current = current.parentElement;
            }
            return background;
        }
        function selectorFor(node) {
            const tag = String(node.tagName || '').toLowerCase();
            const id = node.id ? ('#' + node.id) : '';
            const classes = Array.from(node.classList || []).slice(0, 2).map((name) => '.' + name).join('');
            return (tag || 'node') + id + classes;
        }
        const failures = [];
        const seen = new Set();
        let checked = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const text = String(walker.currentNode.textContent || '').replace(/\\s+/g, ' ').trim();
            if (!text) continue;
            const parent = walker.currentNode.parentElement;
            if (!parent || !isVisible(parent)) continue;
            const tagName = String(parent.tagName || '').toUpperCase();
            if (tagName === 'SVG' || tagName === 'TITLE' || parent.ownerSVGElement) continue;
            if (typeof parent.closest === 'function' && parent.closest('script, style, noscript, svg, title, .sr-only, [aria-hidden="true"]')) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const rects = Array.from(range.getClientRects());
            if (!rects.length || !intersectsViewport(rects)) continue;
            const style = window.getComputedStyle(parent);
            const foreground = parseColor(style.color);
            const background = backgroundFor(parent);
            const ratio = contrastRatio(foreground, background);
            const fontSize = Number.parseFloat(style.fontSize || '16');
            const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
            const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
            checked += 1;
            if (ratio + 0.05 >= threshold) continue;
            const signature = text.slice(0, 60) + '|' + selectorFor(parent);
            if (seen.has(signature)) continue;
            seen.add(signature);
            failures.push({
                background: style.backgroundColor,
                ratio: Number(ratio.toFixed(2)),
                selector: selectorFor(parent),
                text: text.slice(0, 80),
                threshold,
            });
        }
        failures.sort((left, right) => left.ratio - right.ratio);
        return { checked, failures: failures.slice(0, 20) };
    })()`);
}

async function main() {
    const failures = [];
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });

    try {
        const page = await browser.newPage({ viewport: VIEWPORT });
        try {
            for (const route of ROUTES) {
                await gotoRoute(page, route);
                await prepareRoute(page, route);
                for (const theme of THEMES) {
                    await setTheme(page, theme);
                    const result = await collectContrast(page);
                    if (result.failures.length > 0) {
                        result.failures.forEach((failure) => {
                            failures.push(`${route.name} ${theme}: ${failure.selector} "${failure.text}" contrast ${failure.ratio} < ${failure.threshold}`);
                        });
                    }
                    console.log(`Checked ${route.name} ${theme}: ${result.checked} text nodes`);
                }
            }
        } finally {
            await page.close();
        }
    } finally {
        await browser.close();
    }

    if (failures.length > 0) {
        console.error('Theme contrast failures:');
        failures.forEach((failure) => console.error(`- ${failure}`));
        process.exit(1);
    }

    console.log(`PASS Theme contrast checks for ${TEST_URL}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
