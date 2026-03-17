# Beta Tester Report: Light Mode

## Summary

- **Target:** Light mode across the AustralianRates public site (www.australianrates.com).
- **Environment:** Production (https://www.australianrates.com). Theme is toggled via header control and persisted in `localStorage` (`ar-theme`). Default is dark; light is user-selected.
- **Date:** 2025-03-17.
- **Coverage:** Codebase and CSS reviewed for light-theme implementation; theme toggle, foundation and showcase CSS, hero intro, workspace panels, charts, and legal/public pages.
- **Constraints:** Live pages were not exercised in a real browser with light mode forced; findings are from static analysis and CSS specificity. E2E/Playwright could not set theme before load; manual verification of light mode on production is recommended.

## Coverage Map

| URL or state | How discovered | Tested | Notes |
|--------------|----------------|--------|--------|
| `/` (Home Loans) | Nav, section config | Code/CSS | Public workspace, intro, chart, table |
| `/savings/` | Nav, section config | Code/CSS | Same shell, savings API/config |
| `/term-deposits/` | Nav, section config | Code/CSS | Same shell, term-deposit config |
| `/about/`, `/contact/`, `/privacy/`, `/terms/` | Footer, frame nav | Code/CSS | Legal pages, `ar-legal` body class |
| 404 / not-found | frame.js, routeState | Code/CSS | `ar-not-found` |
| Theme toggle | Header `[data-theme-toggle]` | Code | theme.js, persistence, `ar:theme-changed` |
| Chart rendering | ar-charts, echarts helpers | Code | `chartTheme()` uses `data-theme` |
| **Blocked / not tested** | | | Live visual check in browser with light mode on (no headless theme override) |

## Top Priorities

1. **Fix public page background in light mode (High)**  
   `body.ar-public .bg-layer` in `public-showcase.css` always applies a dark gradient (`#060a10`, `#050b11`, `#02050a`). It overrides `:root[data-theme="light"] .bg-layer` from foundation because it is more specific. In light mode the main content area behind the workspace still looks dark. Add a light-mode override so the background layer is light when `data-theme="light"`.

2. **Fix hero intro block in light mode (High)**  
   `.market-intro` and several child blocks in `public-showcase-hero.css` use hardcoded dark colors (e.g. `#07111a`, `#03070c` in the main intro gradient; `rgba(5,10,16)`, `rgba(8,17,27)` in command block and console; `#02050a` in live-card/step and bank-chip). In light mode the intro area stays dark. Add `:root[data-theme="light"] body.ar-public` overrides so intro, command block, console, cards, and chips use light backgrounds and appropriate contrast.

3. **Verify light mode end-to-end (Medium)**  
   Manually load the site, switch to light via the header toggle, and walk all three sections plus legal pages. Confirm no remaining dark-only panels, contrast issues, or unreadable text.

## Findings

### [High] Public page background layer remains dark in light mode

- **URL or location:** All public pages (`/`, `/savings/`, `/term-deposits/`) when `data-theme="light"`.
- **Area:** Bug (styling).
- **Evidence:**  
  - `public-showcase.css` (lines 104–108): `body.ar-public .bg-layer, body.ar-legal .bg-layer` set  
    `background: linear-gradient(180deg, color-mix(... var(--ar-showcase-ink) 78%, #060a10) 0%, #050b11 54%, #02050a 100%);`  
  - No `:root[data-theme="light"] body.ar-public .bg-layer` (or equivalent) in that file.  
  - `foundation.css` has `:root[data-theme="light"] .bg-layer` with a light gradient, but `body.ar-public .bg-layer` has higher specificity and loads later, so it wins on public pages.
- **Reproduction steps:** Set theme to light (header toggle or `localStorage.setItem('ar-theme','light')` and reload), open `/` or `/savings/` or `/term-deposits/`. Observe the full-page background behind the shell.
- **Observed result:** Dark gradient applied to `.bg-layer` on public pages even in light mode.
- **Expected result:** In light mode the background layer should use light colors consistent with `--ar-bg` / `--ar-surface-*` (e.g. light gradient or flat light fill).
- **Impact:** Light mode looks broken: dark strip/background behind an otherwise light UI. Hurts consistency and trust.
- **Recommendation:** In `public-showcase.css`, add a block:  
  `:root[data-theme="light"] body.ar-public .bg-layer,  
  :root[data-theme="light"] body.ar-legal .bg-layer { background: ... }`  
  using a light gradient or `var(--ar-bg)` / `var(--ar-surface-soft)` so the layer matches the rest of the light theme.

---

### [High] Hero intro and command/console blocks use hardcoded dark colors in light mode

- **URL or location:** Public homepage and section pages; `.market-intro`, `.market-intro-command-block`, `.market-intro-console`, `.market-intro-live-card`, `.market-intro-step`, `.market-intro-bank-chip` in `public-showcase-hero.css`.
- **Area:** Bug (styling).
- **Evidence:**  
  - Line 1: `.market-intro` background uses `#07111a` and `#03070c` in `linear-gradient`.  
  - Lines 49, 140: `.market-intro-command-block` and `.market-intro-console` use `rgba(5,10,16)`, `rgba(8,17,27)`, `rgba(3,7,11)`, `rgba(9,19,30)`.  
  - Lines 175, 195: `.market-intro-live-card`, `.market-intro-console-log-shell`, `.market-intro-step` and `.market-intro-bank-chip` use `color-mix(..., #02050a)`.  
  - Only light override present is for prompt text color (lines 68–70: `#0b5a47`).
- **Reproduction steps:** Set theme to light, load `/` or `/savings/` or `/term-deposits/`. Look at the intro block and the “console”/command/live cards.
- **Observed result:** Intro and inner blocks keep dark backgrounds and dark-tinted gradients.
- **Expected result:** In light mode these areas should use light backgrounds (e.g. `var(--ar-surface-2)`, `var(--ar-bg-elevated)`) and theme-aware borders/shadows so they match the rest of the light UI.
- **Impact:** Large, prominent area stays dark in light mode; poor consistency and possible contrast issues (e.g. dark text on dark).
- **Recommendation:** Add `:root[data-theme="light"] body.ar-public` overrides in `public-showcase-hero.css` for:  
  - `.market-intro` background (light gradient using `var(--ar-surface)`, `var(--ar-bg-elevated)` or similar).  
  - `.market-intro-command-block`, `.market-intro-console` backgrounds (light equivalents, no hardcoded dark rgba).  
  - `.market-intro-live-card`, `.market-intro-console-log-shell`, `.market-intro-step`, `.market-intro-bank-chip`: replace `#02050a` fallbacks with a light fallback (e.g. `var(--ar-surface-3)` or a light hex).  
  Optionally adjust `::before` / `::after` grid and overlay opacities so they suit light mode.

---

### [Low] Primary button text color hardcoded for dark-on-accent

- **URL or location:** `public-showcase.css` lines 155–164: `body.ar-public button.primary` (and hover) `color: #04110f`.
- **Area:** UX/polish.
- **Evidence:** Button text is fixed to dark green. In light mode `--ar-accent` is `#168f72`; `#04110f` on it remains readable. In dark (public) `--ar-accent` is `#66f6cf`; dark text on that could be low contrast. Token may be intentional for “accent button” legibility.
- **Impact:** Low; both themes keep sufficient contrast for primary buttons. Could be switched to a CSS variable for consistency.
- **Recommendation:** Consider a token such as `--ar-accent-text` (or `--ar-on-accent`) set per theme and use it for primary button text so future theme tweaks stay consistent.

## Improvement Opportunities

- **Light-mode QA pass:** Run a full click-through of all public and legal pages with theme set to light; capture any missed panels, charts, or modals that still assume a dark background.
- **Contrast and focus:** In light mode, ensure focus rings (`--ar-focus`), borders (`--ar-line-strong`), and error/warning colors remain visible and meet WCAG where required.
- **Charts:** Chart theme already switches via `chartTheme()` and `data-theme`; no change needed except to confirm in the QA pass that axes, labels, and tooltips look correct in light.
- **Documentation:** Add a short “Theming” note (e.g. in a design or contribution doc) that public pages use both foundation and showcase CSS and that any new component with background/border must consider `:root[data-theme="light"]` for public/legal body classes.

## Systemic Themes

- **Dark-first gradients:** Several public-showcase and public-showcase-hero rules were written with dark backgrounds and hardcoded hex/rgba fallbacks. Light mode was added at the foundation and public-showcase body level but not consistently in hero and in the shared `.bg-layer` used by public pages. A pass to replace or override every dark-only gradient/background on public and legal pages would reduce regression risk.
- **Specificity:** `body.ar-public` and `body.ar-legal` increase specificity. Light overrides must use at least `:root[data-theme="light"] body.ar-public` (or equivalent) so they win over theme-agnostic public rules.

## Untested or Blocked Areas

- **Live browser check in light mode:** No automated or manual run was performed with a real browser set to light theme; all conclusions are from code and CSS. Recommendation: manually test `/`, `/savings/`, `/term-deposits/`, `/about/`, `/contact/`, `/privacy/`, `/terms/`, and the 404 page with the theme toggle set to light.
- **Admin pages:** Not in scope; admin was not reviewed for light mode.
- **Mobile/tablet layout in light mode:** Not verified; same CSS applies but viewport-specific issues (e.g. overlays, nav drawer) were not checked.
- **Reduced motion / high contrast:** Not evaluated.

## Final Verdict

- **What is working well:**  
  Foundation and public-showcase define a full light palette (`:root[data-theme="light"]` and `body.ar-public`/`body.ar-legal` overrides for surfaces, text, accent, overlay). Theme toggle and persistence work; charts read `data-theme` and apply light/dark tokens correctly. Most of the shell (header, footer, workspace panels, filters, table) relies on variables and should look correct in light mode.

- **What feels risky or unfinished:**  
  The main content background (`.bg-layer`) and the hero intro block (and its command/console/cards) are still dark in light mode due to missing or overridden light rules. Until those are fixed and checked in a browser, light mode will look inconsistent.

- **Is the site ready for broader users in its current state (light mode)?**  
  Not fully. Users who prefer light theme will see a mixed experience: light shell and panels but a dark background and dark intro section. Fix the two high-priority items above and run a manual light-mode pass; then light mode can be considered ready.

- **What should happen next:**  
  1) ~~Add `:root[data-theme="light"] body.ar-public .bg-layer` (and legal) in `public-showcase.css`~~ **Done:** light `.bg-layer` override added.  
  2) ~~Add `:root[data-theme="light"] body.ar-public` overrides in `public-showcase-hero.css` for `.market-intro` and intro child blocks~~ **Done:** light overrides added for `.market-intro`, `.market-intro-command-block`, `.market-intro-console`, `.market-intro-live-card` / `.market-intro-console-log-shell` / `.market-intro-step`, `.market-intro-bank-chip`.  
  3) Manually verify every public and legal page in light mode and fix any remaining dark-only regions or contrast issues.  
  4) Optionally document theming and light-mode coverage for future changes.
