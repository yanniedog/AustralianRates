# Data visualisation: implementation status

**Target:** Award-winning chart design for Home Loans, Savings, Term Deposits (see .cursor/skills/data-visualisation and docs/CHART_CONFIG_RECOMMENDATIONS.md).

---

## Implemented (current codebase)

| Recommendation | Location | Status |
|----------------|----------|--------|
| Default view = Curve | ar-chart-config.js `defaultView()` = 'market'; ar-public-page.js CHART_VIEWS Curve `selected: true` | Done |
| Curve titles by section | ar-chart-market.js: HL "Borrowing cost by structure", TD "Yield by term", Savings "Rate by balance tier" / "Rate by tier or type" | Done |
| TD default Curve style = Box | ar-public-page.js term-deposits chartTypes: box `selected: true` | Done |
| chartHint for all sections | ar-section-config.js: "For market shape in one snapshot: use the Curve view..." for HL, Savings, TD; Savings adds Distribution; TD adds same-term Compare hint | Done |
| Curve style applies to Curve only | ar-public-page.js: label "Curve style (Curve only)", data-help "Applies to Curve view only" | Done |
| Section palettes (dark/light) | ar-chart-config.js SECTION_PALETTES | Done |
| product_key longitudinal identity | Compare/Movement use product_key; Curve uses snapshot by section dimension | Done |

---

## Reinvention backlog (requires new work)

Items that would raise the bar toward award-winning but need new components, API, or design:

- **HL:** Unified cost landscape (Curve + leader dots per structure); headline vs comparison toggle with clear labelling; Leaders bar + trend (arrow or micro sparkline); annotation layer (RBA, last change).
- **Savings:** Bonus vs base visual encoding (e.g. dashed vs solid by rate_type); Compare view + "market average at this date" or best-in-class context (needs API or client aggregation).
- **TD:** "Compare at same term" default or prompt when opening Compare; Leaders by term (one view: best at 3m | 6m | 12m | 24m – needs new view or aggregation).
- **Cross-cutting:** Slope graph, horizon chart, connected scatter, rate ladder, small multiples (see .cursor/skills/data-visualisation/references/award-winning-and-reinvention.md).

When implementing from this backlog, consider: UX, accessibility, section story (HL = borrowing cost by commitment; Savings = reward by balance/behaviour; TD = yield by term), and project rules (AGENTS.md, real data only, fix-commit-verify when deploy-related).
