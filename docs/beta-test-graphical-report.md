# Beta Test Report: Graphical Aspects

## Summary

- **Target:** Visual and graphical quality of www.australianrates.com (layout, typography, charts, responsiveness, consistency).
- **Environment:** Production (https://www.australianrates.com). Codebase review of `site/` CSS and JS.
- **Date:** 2026-03-17.
- **Coverage:** Public rate pages (Home Loans, Savings, Term Deposits), About, Contact, Privacy, Terms, 404; shell, hero, workspace, analysis, filter pads, results, pivot, mobile; admin not in scope for graphical audit.
- **Constraints:** Live pages are JS-heavy; fetched HTML is minimal. Assessment based on codebase review, CSS structure, responsive breakpoints, chart config, font/theme usage, and one production test run (test:homepage). No manual viewport screenshots; Playwright viewport used for test run.

---

## Coverage Map

| URL / area | Discovered via | Tested | Notes |
|------------|----------------|--------|--------|
| / | index.html, nav | Yes (code + test:homepage) | Main workspace, hero, chart, table |
| /savings/ | Nav | Yes (code) | Same shell/workspace pattern |
| /term-deposits/ | Nav | Yes (code) | Same shell/workspace pattern |
| /about/ | Footer, 404 links | Yes (code) | Legal layout, typography |
| /contact/ | - | Yes (code) | Legal layout |
| /privacy/, /terms/ | Footer | Yes (code) | Legal layout |
| /404.html | - | Yes (code) | Hero panel, CTAs |
| Desktop (1280px+) | CSS media | Yes (code) | 5-col terminal, resizers |
| 1280–980px | CSS media | Yes (code) | 2-col, right rail 2-col |
| 980–760px | CSS media | Yes (code) | 2-col, right rail full width |
| &lt;=760px | CSS media | Yes (code) | Single column, compact header |
| &lt;=560px | Hero/workspace CSS | Yes (code) | Tighter hero/controls |
| Dark/light theme | theme.js, CSS vars | Yes (code) | Chart and UI theme |
| Admin pages | - | No | Out of scope for this graphical audit |

**Blocked / not verified live:** Exact pixel rendering of charts (ECharts/Plotly) and tables (Tabulator) on multiple viewports; contrast and touch-target measurements; visual regression. One Playwright test failed: Pivot tab not visible when clicking (see findings).

---

## Top Priorities

1. **Pivot tab visibility (High)** – In test run, `#tab-pivot` was not visible when the test tried to click it; likely overflow or tab strip layout on the test viewport. Fix tab strip so all workspace tabs (Explorer, Pivot, etc.) remain visible or clearly reachable on desktop and mobile.
2. **Font variable consistency (Low)** – `foundation.css` sets `--ar-font-ui: "Public Sans"` but no page loads Public Sans; all pages load Space Grotesk (and Merriweather for display). Align foundation with actual fonts or load Public Sans for consistency.
3. **Chart and table focus/accessibility (Medium)** – Ensure chart containers and Tabulator get visible focus styles and that chart tooltips/legends meet contrast in both themes; verify from accessibility lens.
4. **Mobile chart surface (Medium)** – Chart surface min-height 420px / 360px can dominate small viewports; confirm compact mode or reduced height on narrow breakpoints so content hierarchy stays clear.
5. **Legal/About brand mark (Low)** – About and Contact use text-only brand (`<a href="/">AustralianRates</a>`); Home and 404 use inline logo. Consider adding the same inline logo to About/Contact for visual consistency.

---

## Findings

### [High] Pivot tab not visible on workspace tab strip

- **URL or location:** Homepage (and likely Savings, Term Deposits) workspace tab strip; element `#tab-pivot`.
- **Area:** bug (layout / visibility).
- **Evidence:** Playwright test failed: `page.click: Timeout 30000ms exceeded` – locator `#tab-pivot` resolved but "element is not visible" (54 retries). Other 47 tests passed, including "workspace tabs render with icon labels" and "chart draw renders ECharts output."
- **Reproduction steps:** Run `npm run test:homepage` (default Playwright viewport). Test clicks Explorer then Pivot; Pivot click times out.
- **Observed result:** Pivot tab exists in DOM but is not visible (likely off-screen or hidden by overflow).
- **Expected result or standard:** All workspace tabs (Explorer, Pivot, etc.) should be visible or keyboard-focusable so users can switch views.
- **Impact:** Users may be unable to open the Pivot view if the tab strip overflows or layout hides the Pivot tab.
- **Recommendation:** Inspect `.site-header-actions` / tab strip at 760px and at test viewport width: ensure overflow is scrollable (e.g. `overflow-x: auto`) with visible affordance, or collapse to a menu so Pivot is reachable. Add a test that asserts Pivot tab is in view or focusable after Explorer loads.

---

### [Medium] Chart surface and empty states – fixed min-heights on small viewports

- **URL or location:** All three rate sections; `.terminal-chart-surface`, `#chart-output`, `#chart-detail-output`, `.chart-output-empty` etc.
- **Area:** UX / layout.
- **Evidence:** `public-analysis.css`: `.terminal-chart-surface { min-height: 420px }`, `.terminal-chart-output, #chart-output, #chart-detail-output { min-height: 360px }`, `.chart-output-empty` etc. `{ min-height: 220px }`. No reduced min-heights in `@media (max-width: 760px)` or 560px for chart area.
- **Reproduction steps:** Resize to 760px or 560px width; open a chart view.
- **Observed result:** Chart container reserves at least 360–420px vertical space; on short/narrow screens this can push table and filters down and dominate the fold.
- **Expected result or standard:** On mobile or narrow viewports, chart area could use a smaller min-height (e.g. 260px) or a "compact chart" mode so the one-question-per-screen idea (data-visualisation skill) is easier to achieve.
- **Impact:** Mobile users may see a large empty or sparse chart area and need to scroll to reach table or filters.
- **Recommendation:** Add a breakpoint (e.g. max-width: 760px or 560px) that reduces `.terminal-chart-surface` and chart output min-heights (e.g. to 260–280px) or add a density/compact toggle that reduces chart height when active.

---

### [Medium] About / Contact header missing inline logo

- **URL or location:** `/about/`, `/contact/` – header brand.
- **Area:** UX / consistency.
- **Evidence:** `about/index.html`: `<h1 class="site-brand"><a href="/">AustralianRates</a></h1>` (no `<img>`). `index.html` and `404.html`: `<h1 class="site-brand"><a href="/"><img src="/assets/branding/ar-mark.svg" alt="" class="site-brand-inline-logo">AustralianRates</a></h1>`.
- **Reproduction steps:** Open / then /about/; compare header branding.
- **Observed result:** Home and 404 show mark + text; About and Contact show text only.
- **Expected result or standard:** Shared shell should look consistent; brand mark supports recognition.
- **Impact:** Minor visual inconsistency between public rate pages and legal pages.
- **Recommendation:** Add the same `<img src="/assets/branding/ar-mark.svg" alt="" class="site-brand-inline-logo">` before "AustralianRates" in About and Contact (and Privacy/Terms if they use the same pattern).

---

### [Low] Foundation CSS font variable not aligned with loaded fonts

- **URL or location:** `site/foundation.css` (root), all pages.
- **Area:** other (consistency / maintainability).
- **Evidence:** `foundation.css` line 23: `--ar-font-ui: "Public Sans", "Segoe UI Variable", "Segoe UI", sans-serif;`. No HTML file in site/ links to Google Fonts "Public Sans". All public and legal pages link to Merriweather + Space Grotesk. `public-showcase.css` overrides `--ar-font-ui` and `--ar-font-display` for `body.ar-public` and `body.ar-legal` to Space Grotesk / Merriweather.
- **Reproduction steps:** Inspect computed font on body; check network for Public Sans.
- **Observed result:** Public Sans is never loaded; effective UI font is Space Grotesk. Foundation’s default is misleading for future edits.
- **Expected result or standard:** CSS variables should match loaded fonts or be the single source of truth for font stack.
- **Impact:** Low; visual output is correct due to overrides. Risk of someone changing only foundation and expecting Public Sans.
- **Recommendation:** Change `foundation.css` default `--ar-font-ui` to `"Space Grotesk", "Segoe UI Variable", "Segoe UI", sans-serif` so it matches loaded fonts and overrides remain redundant but correct; or document that public-showcase.css is the canonical font set for public/legal.

---

### [Low] 404 content only in noscript block in static HTML

- **URL or location:** `site/404.html`.
- **Area:** UX / content visibility.
- **Evidence:** 404 copy ("Page not found.", CTAs) is inside `<noscript>`; main content is `<div id="ar-section-root"></div>`. If JS runs, frame.js likely injects content; if JS fails, user sees only the noscript block. Unclear whether 404 panel is also rendered by JS into `#ar-section-root` with same styling as legal-hero.
- **Reproduction steps:** Load 404 with JS enabled; load with JS disabled.
- **Observed result:** With JS, content may be injected and match other pages; with JS off, user gets the noscript panel. If injected 404 uses different structure, visual consistency could vary.
- **Expected result or standard:** 404 page should present the same graphical treatment (hero, buttons, spacing) whether rendered server-side, client-side, or in noscript.
- **Impact:** Low; most users have JS. Possible slight difference in look if JS-rendered 404 differs from noscript.
- **Recommendation:** Confirm frame.js (or equivalent) renders the 404 panel with classes `legal-hero`, `missing-route-panel` so it matches the noscript and 404 styling in public-showcase/public-shell. If not, align markup and classes.

---

## Improvement Opportunities (Graphical)

- **Charts (ECharts):** Theme already uses `chartTheme()` for light/dark (text, grid, tooltip). Consider explicitly setting axis label font size for mobile (e.g. from `baseTextStyles()`) so labels stay readable on small chart areas if you add a compact height.
- **Resizers:** Terminal column resizers use a detailed `::after` grip and clear hover/focus state; good. Ensure the resizer is keyboard-focusable and that focus ring is visible in both themes.
- **Tab strip (760px):** Header actions become a horizontal scroll strip with `overflow-x: auto`; confirm scrollbar or hint (e.g. fade or arrow) so users know more tabs exist. Directly addresses Pivot visibility.
- **Legal panels:** Legal hero and panels use consistent padding (18px), gap (18px), and panel styling; good. Consider max-width on legal body copy (e.g. 65ch) for long paragraphs to keep line length comfortable.
- **Section theming:** Section-specific `--ar-showcase-glow` and `--ar-showcase-spark` (HL, Savings, TD, legal) give a distinct tint per section; reinforces orientation. No change needed; keep for future sections.

---

## Systemic Themes

- **Responsive breakpoints are consistent:** 1280, 980, 760, 560 (and 1200, 1100, 820 in places). Chart/table layout and terminal columns collapse in a predictable way. Single breakpoint (760) is used in many files for "mobile."
- **Design tokens:** `foundation.css` and `public-showcase.css` define a full token set (space, radius, motion, colours, fonts). Dark/light and section overrides are centralised. Good for future graphical tweaks.
- **Charts:** Section palettes (dark/light) in `ar-chart-config.js`, ECharts helpers use theme-aware colours and Space Grotesk. One source of chart styling; reduces drift.
- **Typography:** Display (Merriweather) vs UI (Space Grotesk) is clearly split on public/legal; only foundation’s default font variable is out of sync.

---

## Untested or Blocked Areas

- **Admin UI:** Not reviewed for this graphical audit.
- **Live visual regression:** No screenshot or pixel comparison; assessment from code and one Playwright run.
- **Real-device mobile:** Only CSS breakpoints reviewed; not tested on physical devices or multiple mobile browsers.
- **Chart interaction:** Tooltip placement, legend overlap, and zoom/pan on touch not verified.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` in foundation.css disables transitions; not verified that charts and UI respect it (ECharts may have its own animation settings).

---

## Final Verdict

- **What is working well:** Clear design system (tokens, section colours, dark/light). Responsive grid (terminal columns, resizers) and breakpoints are consistent. Chart theming is centralised and section-specific. Hero and legal panels are styled consistently. Skip link, focus-visible outline, and semantic structure support accessibility.
- **What feels risky or unfinished:** Pivot tab visibility on the tab strip (test failure) should be fixed so all workspace tabs are reachable. Chart min-heights on small viewports could be tuned. Minor inconsistencies (font variable, About/Contact logo, 404 markup) are low-risk but easy to fix.
- **Ready for broader users?** Yes, with the caveat that the Pivot tab visibility issue should be resolved so all features are discoverable. Graphical presentation is coherent and professional; no critical visual bugs found beyond that layout issue.
- **What should happen next:** (1) Fix Pivot tab visibility/overflow and re-run test:homepage. (2) Optionally reduce chart min-heights on mobile and add inline logo to About/Contact. (3) Align foundation font variable with loaded fonts. (4) If desired, add a quick accessibility pass on chart focus and tooltip contrast.
