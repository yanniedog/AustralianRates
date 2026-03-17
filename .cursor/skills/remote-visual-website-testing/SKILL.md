---
name: remote-visual-website-testing
description: Enables remote visual testing of websites by capturing screenshots, snapshots, page content, and user interactions (clicks, mouse movements, scrolls, keyboard). Teams can autonomously analyze visual and graphical content and replay or inspect interaction recordings. Use when taking screenshots, capturing page snapshots, recording clicks or mouse movements, running visual regression, or when the user asks to test or analyze a website visually, capture screen content, record interactions, or review UI/layout remotely.
---

# Remote Visual Website Testing

Enables the team to capture website content (screenshots, HTML, snapshots) and **user interactions** (clicks, mouse movements, scrolls, keyboard, focus) so they can analyze visual content and replay or inspect sessions. Use when you need screenshots, page state, or interaction recordings for autonomous review.

---

## Capture methods

| Goal | How | Output |
|------|-----|--------|
| **Screenshots (full page or viewport)** | Run Playwright scripts. Homepage test saves on failure to `./test-screenshots/`. Visual audit saves to `./test-screenshots/visual-audit-<timestamp>/captures/`. | PNG files on disk. |
| **Structured visual audit** | `npm run audit:visual` (from repo root). Uses `tools/node-scripts/src/visual-audit.ts`: multiple routes, viewports (desktop/tablet/mobile), and states; full-page screenshots per state. | Dossier HTML + PNGs in `test-screenshots/visual-audit-*`. |
| **Clicks, mouse, scroll, keyboard** | Playwright trace: start tracing on the context, perform or script the interactions, stop and save. See [Recording user interactions](#recording-user-interactions) below. | `trace.zip` (view with `npx playwright show-trace trace.zip`). |
| **HTML / structure** | Fetch production (e.g. `mcp_web_fetch` or `GET`). Returns markup only—good for structure, headings, meta, copy. | Markdown/text. Not pixels. |
| **User-provided screenshots** | User attaches images. Agent analyzes layout, contrast, hierarchy, and suggests improvements. | In-chat analysis. |

---

## Quick workflow

1. **Decide capture type:** Screenshot (Playwright), interaction trace, HTML fetch, or user screenshot.
2. **Screenshots:** Run `npm run test:homepage` (saves to `./test-screenshots/` on failure) or `npm run audit:visual` for a full visual audit. For **interaction recording**, add tracing to a Playwright script (see Recording user interactions) and run it; save `trace.zip` for the team.
3. **Analyze:** Use saved PNGs, trace viewer (`npx playwright show-trace trace.zip`), fetched HTML, or user-attached images. Comment on layout, contrast, hierarchy, interactions, and suggest concrete changes.

---

## Repo scripts (this project)

| Script / command | Purpose |
|------------------|---------|
| `npm run test:homepage` | Playwright E2E vs production; saves screenshots to `./test-screenshots/` when a test fails. |
| `npm run audit:visual` | Full visual audit: many routes × viewports × states; writes screenshots and dossier to `test-screenshots/visual-audit-<timestamp>/`. |
| `node tools/node-scripts/src/beta-test-capture-log.ts` | Traverses public pages, captures client log (no screenshots). |
| `TEST_URL` | Set to target base URL (e.g. `https://www.australianrates.com/` or a staging URL) for homepage test and audit. |

---

## Recording user interactions

Capture **clicks, mouse movements, scrolls, keyboard input, and focus** so the team can replay and analyze sessions.

**Playwright trace (recommended)** — records actions, DOM snapshots, screenshots, and network:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' });
  // Script or drive interactions: page.click(...), page.mouse.move(...), page.keyboard.type(...), etc.
  await context.tracing.stop({ path: 'test-screenshots/trace.zip' });
  await browser.close();
})();
```

- **View trace:** `npx playwright show-trace test-screenshots/trace.zip` (timeline, screenshots, DOM, network).
- **What is recorded:** Every action (click, fill, key, hover, scroll), DOM snapshots at each step, optional screenshots and network. Mouse movement can be inferred from action sequence; for continuous pointer movement, use `page.mouse.move(x, y)` in a loop or record via CDP if needed.

**Optional: video** — set `recordVideo: { dir: 'test-screenshots/videos' }` on `newContext()` to get a video file of the session (includes all visible interaction).

**Optional: HAR** — use `context.route()` and record HAR for network-only analysis; combine with trace for full interaction + network.

When adding recording to an existing script (e.g. `test-homepage.ts` or a small capture script), start tracing before navigation and stop after the last interaction; save `trace.zip` under `test-screenshots/` so the team can open it without extra setup.

---

## Autonomous analysis

- **From screenshots:** After running an audit or test, reference the saved paths (e.g. `test-screenshots/visual-audit-*/captures/.../desktop-rates-full.png`). If the agent can read images, analyze them; otherwise describe what to look for and suggest code/CSS changes from repo context.
- **From interaction traces:** Open `trace.zip` with `npx playwright show-trace trace.zip` to inspect timeline, DOM snapshots, and screenshots at each step. Use this to debug flaky flows, document click paths, or verify that interactions (clicks, scrolls, keyboard) produce the expected UI state.
- **From HTML fetch:** Infer layout and content from markup; recommend structure, semantics, and copy changes.
- **From user screenshots:** Treat attached images as the source of truth; critique and suggest improvements with concrete file/line or component references where possible.

Keep capture simple: prefer one clear target (URL + path + viewport) per run so outputs stay easy to find and compare.
