# Figma setup for Australian Rates

This document is an internal checklist and file-structure guide for using **Figma** as a design spec layer for the static frontend in `site/`. Figma does not replace production HTML/CSS/JS; it documents tokens, components, and layouts before or alongside implementation.

## Account and billing (you complete these)

1. **Sign up** – [figma.com/signup](https://www.figma.com/signup) (use your own email; verify inbox).
2. **Choose a plan** – [figma.com/pricing](https://www.figma.com/pricing)  
   - **Starter** is enough to explore solo.  
   - **Professional** adds team libraries and stronger Dev Mode if multiple people edit or hand off specs.  
   - Pricing, seats, and AI credits change on Figma’s site; confirm there before subscribing.
3. **Create a team** (optional on paid tiers) – e.g. name it `Australian Rates`.
4. **Create a project** – e.g. `Public UI` and optionally `Admin UI`.

## First-hour checklist

- [ ] New **design file** in the project (see suggested structure below).
- [ ] One page **Reference**: paste or import screenshots from [production](https://www.australianrates.com) for key routes (home, savings, term deposits, home loans, one chart-heavy view, narrow mobile width).
- [ ] One page **Tokens**: color styles, text styles, spacing scale aligned with `site/foundation.css`, `site/public-shell.css`, and `site/theme.js` (or document a target refactor).
- [ ] One page **Components**: shell (header/footer/nav), buttons, links, filter-pad patterns, table chrome, empty/loading/error blocks, chart **frames** (slots only; real charts stay in ECharts/lightweight-charts in code).
- [ ] One page **Screens**: a few end-to-end frames (desktop + mobile) for critical journeys; use **variants** for states (default, hover, disabled, error, empty).
- [ ] **Share** the file: comment-only links for stakeholders; edit access only for people who need it.
- [ ] **Handoff**: when implementing, use Dev Mode (where your plan includes it) to read spacing, type, and colors; translate into `site/*.css` and HTML manually.

## Suggested file structure (pages)

| Page / section | Purpose |
|----------------|---------|
| `00 Cover` | File title, owner, last synced URL, note linking this doc. |
| `01 Reference` | Production screenshots; optional URL + date captured. |
| `02 Tokens` | Color, type, radius, elevation; Figma variables if you use modes (e.g. density). |
| `03 Components` | Auto layout components with variants; map names to CSS classes or BEM-ish labels you use in `site/`. |
| `04 Public – Desktop` | Key public pages at desktop breakpoints. |
| `05 Public – Mobile` | Same journeys at mobile width; table/list alternatives. |
| `06 Admin` | Admin shell and high-traffic admin screens (`site/admin/`) if you design them in Figma. |
| `07 Archive` | Old explorations; keep main pages clean. |

## Mapping to the repo

- **Styles**: `site/foundation.css`, `site/public-shell.css`, `site/responsive.css`, section CSS such as `public-filter-pads.css`, `public-results.css`.
- **Behavior**: chart and table behavior live in JS (`site/ar-*.js`, vendors); Figma shows layout and states, not working widgets.
- **Verification**: after shipping CSS/HTML changes, re-check [production](https://www.australianrates.com); optional Playwright: `npm run test:homepage` from repo root.

## Keeping design and code aligned

- Prefer **either** updating Figma after a visual release **or** scheduling a periodic resync from screenshots so the file does not silently drift.
- Treat Figma as the **source of intent** for new work; treat the **live site** as the source of truth for what users see.
