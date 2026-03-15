# Chart configuration recommendations: most informative and best data visualisation

**Target:** Home Loans (HL), Savings, Term Deposits (TD) chart configurations  
**Source:** Codebase analysis (ar-chart-config.js, ar-section-config.js, ar-public-page.js, ar-chart-market.js, ar-charts.js, ar-chart-echarts.js)  
**Date:** 2026-03-15

---

## Summary

- **Scope:** Chart views, X/Y/group axes, chart type, density, and representation options per section.
- **Conclusion:** The most informative and best-visualisation configurations are section-specific; one “best” preset per section is recommended below, with alternatives for different user goals.

---

## Available configurations (by section)

### Views (shared)

| View        | Purpose |
|------------|---------|
| **Leaders** | Best current product per lender (bar chart). |
| **Curve**   | Market curve for latest snapshot (HL: rate structure; Savings: deposit tier / rate type / account type; TD: term length). Line, ribbon, or box-whisker. |
| **Movement** | Rate over time, heatmap-style (surface). |
| **Compare** | Shortlist series over time (line chart, up to density.compareLimit). |
| **Distribution** | Box-whisker + mean by group (default group = bank_name when “Product series” selected). |

### Home Loans (HL)

- **Y axis:** Interest rate (default), Comparison rate, Annual fee, Cash rate.
- **X axis:** Collection date (default), Bank, Structure, LVR band, Features.
- **Group by:** No grouping, Product series (default), Bank, Purpose, Structure, LVR band, Features, Repayment.
- **Chart type:** Line (default), Ribbon, Box-whisker (Curve only).
- **Curve dimension:** Rate structure (variable, fixed 1y–5y).

### Savings

- **Y axis:** Interest rate (default), Monthly fee.
- **X axis:** Collection date (default), Bank, Account type, Rate type, Deposit tier.
- **Group by:** No grouping, Product series (default), Bank, Account type, Rate type, Deposit tier.
- **Chart type:** Line (default), Ribbon, Box-whisker (Curve only).
- **Curve dimension:** Auto (deposit_tier if varied, else rate_type, else account_type).

### Term Deposits (TD)

- **Y axis:** Interest rate only.
- **X axis:** Collection date (default), Bank, Term length, Deposit tier, Payment frequency.
- **Group by:** No grouping, Product series (default), Bank, Term length, Deposit tier, Payment frequency.
- **Chart type:** Line (default), Ribbon, Box-whisker (Curve only).
- **Curve dimension:** Term length (months).

---

## Recommended configurations: most informative and best visualisation

### Home Loans (HL)

**Most informative single configuration**

- **View:** **Curve**  
- **Y axis:** Interest rate (or Comparison rate when comparing like-for-like).  
- **X axis:** N/A (Curve uses rate structure on X).  
- **Chart type:** **Line** for clarity; **Box-whisker** when you want spread (min/median/max) across variable vs fixed terms.  
- **Filters:** Narrow to one purpose (owner-occupied or investment) and one repayment type (P&amp;I or IO) for a clean curve.

**Why:** Curve shows the yield curve by rate structure (variable vs fixed 1y–5y) in one snapshot. That is the most informationally dense view for “what does the market look like by structure?” and supports comparison across banks on the same structure. Leaders view is best for “who is cheapest right now?”; Movement and Compare are best for “how did this product or shortlist change over time?”

**Best data visualisation**

- **Curve + Line:** Clearest for trend along structure (variable → 1y → 2y → …).  
- **Curve + Box-whisker:** Best when you want to see range and median per bucket (e.g. spread across lenders at each term).  
- **Compare view**, X = Collection date, Group = Product series, 1–2 banks filtered: best for longitudinal comparison of a few products (clear line chart over time).

---

### Savings

**Most informative single configuration**

- **View:** **Curve**  
- **Y axis:** Interest rate.  
- **Chart type:** **Line** (or **Box-whisker** if you want spread by tier/type).  
- **Filters:** Optional: one account type or one rate type to reduce noise.

**Why:** Curve uses the section’s most varied dimension (deposit_tier, rate_type, or account_type), so one chart shows “rate by tier/type” across banks. That answers “where do the best rates sit by balance or rate type?” Leaders gives “best product per bank”; Distribution gives “spread of rates by bank” for the current slice.

**Best data visualisation**

- **Curve + Line:** Best for “rate by tier/type” trend.  
- **Distribution view**, Group = Bank (or leave Product series so effective group = bank_name): box-whisker by bank is very effective for “spread and median by lender” in the current slice.  
- **Compare**, X = Collection date, Group = Product series, one bank: best for “how did this savings product change over time?”

---

### Term Deposits (TD)

**Most informative single configuration**

- **View:** **Curve**  
- **Y axis:** Interest rate.  
- **Chart type:** **Line** for term structure; **Box-whisker** for spread at each term.  
- **Filters:** Optional: one deposit tier or one payment frequency for a cleaner curve.

**Why:** Curve X-axis is term length (months). That is the natural “term structure” for term deposits (e.g. 3m vs 6m vs 12m vs 24m). One snapshot answers “what does the yield curve look like by term?” and which banks lead at each term. Leaders answers “best product per bank”; Compare answers “how did selected products move over time?”

**Best data visualisation**

- **Curve + Line:** Best for term structure (rate vs term).  
- **Curve + Box-whisker:** Best for spread at each term across banks.  
- **Compare**, X = Collection date, Group = Product series, filter by term (e.g. 12 months): best for “how did 12m rates evolve over time?” for a shortlist.

---

## Summary table: recommended “best” per section

| Section   | Most informative view | Best visualisation choice        | Alternative for “over time”      |
|----------|------------------------|-----------------------------------|-----------------------------------|
| **HL**   | Curve                  | Curve + Line or Box-whisker      | Compare, X=Date, Group=Product    |
| **Savings** | Curve               | Curve + Line; Distribution by Bank | Compare, X=Date, Group=Product    |
| **TD**   | Curve                  | Curve + Line or Box-whisker      | Compare, X=Date, Group=Product    |

---

## Findings (by severity)

### [Low] Section hints could emphasise Curve for “market shape”

- **Location:** ar-section-config.js `chartHint` (all three sections).  
- **Current:** “For rate over time per product: X = Date, Group by = Product, filter by one bank.”  
- **Evidence:** Same hint for HL, Savings, and TD; it only describes time-series (Movement/Compare), not Curve.  
- **Impact:** Users may underuse the most informative view (Curve) for “market shape” per section.  
- **Recommendation:** Add a second sentence, e.g. “For market shape in one snapshot: use the Curve view.”

### [Low] Chart type only affects Curve view

- **Location:** Chart controls (Line / Ribbon / Box-whisker); ar-chart-market.js `curveStyle(fields.chartType)`.  
- **Evidence:** Scatter/bar/box only change Curve rendering; other views ignore chart type.  
- **Impact:** Users changing “Curve style” while on Leaders/Movement/Compare see no change.  
- **Recommendation:** Either show “Curve style” only when Curve view is selected, or add helper text: “Curve style applies to Curve view only.”

---

## Improvement opportunities

- **UX:** Default view could be **Curve** for users who land on a section for the first time (with Leaders as an alternative default for “best rate now”). Config is currently default view = Leaders; consider A/B or section-specific default.  
- **Clarity:** Short in-UI hints per view (e.g. under the view chips) could state “Curve: market shape by structure/term/tier” and “Compare: selected products over time.”  
- **Consistency:** All three sections share the same chart controls pattern; the only divergence is Curve dimension (HL: rate_structure, Savings: auto, TD: term_months), which is already appropriate.

---

## Blindspot check

- **Project rules:** AGENTS.md and .cursor rules: no deploy or test run was required for this analysis-only task.  
- **Mission:** Chart recommendations align with longitudinal product_key identity (Compare/Movement use product_key; Curve uses snapshot by section-specific dimension).  
- **Verification:** Recommendations are based on code and config only; no production E2E or visual regression was run.
