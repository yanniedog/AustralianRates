---
name: data-visualisation
---

# Data Visualisation (Australian Rates)

Provides **deep, creative, award-winning-level** guidance for chart design in **Home Loans (HL)**, **Savings**, and **Term Deposits (TD)**. The agent must think fundamentally: not only tune existing views but **reinvent** where it would make the viz memorable, clear, and jury-ready. Apply when adding, changing, or reviewing chart behaviour or when the user asks for the best, most informative, or award-winning visualisation.

---

## Think deeply first

Before suggesting any chart:

1. **What is the one question this chart must answer in under 10 seconds?** If there are two questions, consider two charts or a clear hierarchy (primary vs secondary).
2. **What would an award jury (Malofiej, Kantar, Information is Beautiful) criticise?** Chartjunk? No narrative? No surprise? Truncated axis? Unclear units?
3. **Is the current encoding the right one?** Could a slope graph, horizon chart, connected scatter, or small multiples tell the story better? See [references/award-winning-and-reinvention.md](references/award-winning-and-reinvention.md).
4. **What is the section's story?** HL = borrowing cost by commitment (structure); Savings = reward by balance and behaviour (tier/type); TD = yield by time (term). Design for that story.
5. **Can we reduce steps?** Can the user answer "who's best at 2y fixed?" or "best 12m TD" in one view without switching view or filter? If not, propose a combined or new view.

Do not default to "use Curve" or "use Leaders" without asking whether the current set of views is sufficient for award-winning clarity and impact.

---

## Award-winning bar (principles)

- **Truthful:** One series = one canonical product over time (product_key). No chart that implies continuity across different products. Comparison rate vs headline clearly distinguished when comparing HL products.
- **Clear:** One primary question per view. Axis labels, units (%, $), and legend unambiguous. Data-ink ratio high; remove grid and decoration that don't carry information.
- **Surprise or insight:** The viz should reveal something not obvious from the table (curve shape, who crosses whom over time, spread vs median). Narrative over decoration.
- **Efficient:** Default to the view that answers the user's likely question. Prefer fewer, ranked series with "see more" over showing everything. Density (compact/standard/expanded) is a design lever.
- **Accessible:** Sufficient contrast (section palettes in ar-chart-config.js), visible focus states, readable labels at mobile sizes. Colour is not the only channel.
- **Section-appropriate:** HL = structure curve and comparison rate; Savings = tier/type curve and distribution by bank; TD = term-structure curve. Frame axes and titles for that story.
- **Craft:** Typography, alignment, spacing, and interaction feel intentional. Propose annotations only when data-driven and sparse (e.g. RBA date, last change).

---

## When to use which view (current set)

| User need | View | Section note |
|-----------|------|---------------|
| "What does the market look like right now?" | **Curve** | HL: rate structure; Savings: tier/type; TD: term length. |
| "Who has the best rate right now?" | **Leaders** | Bar of best product per bank. |
| "How did these products change over time?" | **Compare** | X = Date, Group = Product; filter to 1–2 banks or shortlist. |
| "Movement over time (heatmap)" | **Movement** | Surface: dates vs series. |
| "Spread of rates by lender/dimension" | **Distribution** | Box-whisker by group (default group = bank when Product series). |

Use these when optimising within the current implementation. When reinventing, propose **new or combined views** as in [references/award-winning-and-reinvention.md](references/award-winning-and-reinvention.md).

---

## Reinvention mandate

The agent **must** consider and, when relevant, propose:

- **New or combined views:** e.g. Curve + leader dots in one frame; small multiples by structure/term; "rate ladder" (rank + value).
- **New encodings:** slope graph (two dates), horizon chart (many series), connected scatter (rate vs fee over time), annotation layer (RBA, last change).
- **Clearer framing:** Axis and title copy that tell the section story ("Yield by term", "Rate by balance tier", "Borrowing cost by commitment").
- **Default and prompt changes:** e.g. default Curve to comparison rate for HL when slice is comparative; prompt "Compare at same term" for TD.
- **Reduction of steps:** One-view answers where possible; "see more" instead of showing all series.

Implementation may require new UI, new API, or new components. The agent should state when a recommendation needs code/config beyond the existing controls (view, Y, X, group, chart type, density, representation). See [references/award-winning-and-reinvention.md](references/award-winning-and-reinvention.md) for concrete reinvention ideas per section and novel chart types.

---

## Chart type (curve style) and density

- **Line:** Default for Curve; best for trend along structure/tier/term. Use for clarity and scanability.
- **Ribbon:** Alternative for Curve when emphasising band.
- **Box-whisker:** Use when the key message is spread (min/median/max) at each bucket; strong for "range across lenders." Consider defaulting TD Curve to box for "spread at term."
- **Density:** Compact (12, 4) for mobile or focus; Standard (24, 6) default; Expanded (40, 8) for power users. Prefer constraining visible series and ranking by rate then points.

Chart type only affects **Curve** view. For other views, propose new encodings (e.g. trend arrow on Leaders) if it would raise the award bar.

---

## Colour and theming

- Section palettes in `site/ar-chart-config.js` (SECTION_PALETTES, dark/light). Use for series and curve; no one-off colours for the same semantic.
- Reserve emphasis colour for spotlight or delta. Ensure contrast for grid, axis text, and tooltips in both themes.

---

## Implementation alignment

- Current views and options: `site/ar-public-page.js` (chartMetrics, chartX, chartGroups), `site/ar-section-config.js` (chartHint, pivotFieldLabels).
- Curve dimension logic: `site/ar-chart-market.js` (bucketDescriptor; HL = rate_structure, Savings = chosen field, TD = term_months).
- When suggesting **reinvention** or **new views/encodings**, say explicitly what would require new code or API; do not limit suggestions to existing controls when the goal is award-winning reinvention.

---

## Browser-agent MCP (live chart and UI verification)

Code review alone is not enough to judge chart readability, colour, tooltips, density, mobile breakpoints, or theme switching. When the task is **reviewing or validating visualisation on the live site** (especially **Home Loans**, **Savings**, **Term Deposits**), use the **browser-agent** MCP as the **primary** tool whenever it is enabled.

| Item | Detail |
|------|--------|
| MCP server (Cursor) | **`browser_agent_cursor`** — `.cursor/mcp.json`; sibling repo **`../browser-agent`**. |
| `session_create` | **`projectId`: `australianrates`** and **`manifestPath`** to this repo’s **`browser-agent.manifest.json`** (path relative to browser-agent cwd, e.g. `../australianrates/browser-agent.manifest.json`). |
| Host | **`https://www.australianrates.com`** for production checks. |
| What to exercise | Open each relevant section; switch **chart view** (Curve, Leaders, Compare, Movement, Distribution), **Y/X/group**, **curve style** (line/ribbon/box), **density**, and **light/dark** if exposed; capture **viewport and full-page `screenshot`s** at desktop, tablet, and mobile emulation; use **`console_capture`** / **`network_capture`** if charts fail to load. |
| Tool order | Same as **`../browser-agent/cursor-adapter.md`**: `session_create` → `trace_start` → actions → screenshots → failure bundle → `trace_stop` → `session_close`. Keep **`correlationId`** in write-ups. |
| Blocked actions | Manifest may disallow **`download`**; rely on screenshots and network evidence. |

If browser-agent is **unavailable**, state that limitation and fall back to **`npm run audit:visual`** or scoped manual checks — do not assert pixel-perfect or interaction behaviour without live capture.

---

## Output format when giving recommendations

1. **Section:** HL / Savings / TD (or "all").
2. **Goal:** e.g. "market shape," "best rate now," "over time," or "reinvent for award-winning."
3. **Preset (if using current views):** View + Y + X + Group + chart type (if Curve) + density.
4. **Reinvention (if applicable):** One or more concrete ideas: new/combined view, new encoding, annotation, default change, or copy framing. Reference award gap and rationale.
5. **Rationale:** Why this is the most informative or award-worthy; what a jury would notice.
6. **Caveats and implementation:** Filters to apply; "Curve style only affects Curve"; or "requires new component/API" when relevant.

For detailed presets, see [references/section-presets.md](references/section-presets.md). For award criteria, reinvention ideas per section, and novel chart types, see [references/award-winning-and-reinvention.md](references/award-winning-and-reinvention.md). For project chart config and findings, see [docs/CHART_CONFIG_RECOMMENDATIONS.md](../../docs/CHART_CONFIG_RECOMMENDATIONS.md).
