# Section presets: award-winning data viz

Canonical presets and rationale for Home Loans, Savings, and Term Deposits. Use these when the agent needs exact view/axis/group/curve-style recommendations per section. For reinvention ideas (new views, encodings, annotations), see [award-winning-and-reinvention.md](award-winning-and-reinvention.md).

---

## Home Loans (HL)

### Best single chart: market shape

- **View:** Curve  
- **Y:** Interest rate (or Comparison rate for like-for-like)  
- **Chart type:** Line (clarity) or Box-whisker (spread at each structure)  
- **Filters:** One purpose (owner-occupied or investment), one repayment (P&I or IO) for a clean curve  

**Rationale:** Curve shows yield by rate structure (variable, fixed 1y–5y) in one snapshot. Highest information density for "what does the market look like by structure?" and supports bank comparison on the same structure.

### Alternative: best rate now

- **View:** Leaders  
- **Y:** Interest rate or Comparison rate  
- **Density:** Standard or Compact  

**Rationale:** Bar of best product per bank; immediate answer to "who is cheapest right now?"

### Alternative: over time (shortlist)

- **View:** Compare  
- **X:** Collection date | **Group:** Product series  
- **Filters:** 1–2 banks (or shortlist)  
- **Density:** Standard (6 series)  

**Rationale:** Line chart over time for a few products; clear longitudinal comparison without clutter.

**Reinvention:** Unified cost landscape (Curve + leader dots per structure); headline vs comparison toggle; delta/vs-last-month encoding; Leaders with tiny trend; annotation layer (RBA, last change). See award-winning-and-reinvention.md.

---

## Savings

### Best single chart: market shape by tier/type

- **View:** Curve  
- **Y:** Interest rate  
- **Chart type:** Line (trend) or Box-whisker (spread by tier/type)  
- **Filters:** Optional: one account type or one rate type to reduce noise  

**Rationale:** Curve uses the most varied dimension (deposit_tier, rate_type, or account_type). Answers "where do the best rates sit by balance or rate type?"

### Alternative: spread by lender

- **View:** Distribution  
- **Group:** Bank (or leave Product series so effective group = bank_name)  
- **Y:** Interest rate  

**Rationale:** Box-whisker by bank is very effective for "spread and median by lender" in the current slice.

### Alternative: over time (one product)

- **View:** Compare  
- **X:** Collection date | **Group:** Product series  
- **Filters:** One bank  

**Rationale:** "How did this savings product change over time?" with minimal series.

**Reinvention:** Curve framed as "reward by balance"; bonus vs base encoding; Distribution as "spread story"; Compare with market-average context; sparse annotations. See award-winning-and-reinvention.md.

---

## Term Deposits (TD)

### Best single chart: term structure

- **View:** Curve  
- **Y:** Interest rate  
- **Chart type:** Line (term structure) or Box-whisker (spread at each term)  
- **Filters:** Optional: one deposit tier or one payment frequency for a cleaner curve  

**Rationale:** Curve X-axis is term length (months). Natural yield curve (e.g. 3m vs 6m vs 12m vs 24m). One snapshot answers "what does the yield curve look like by term?" and which banks lead at each term.

### Alternative: best rate now

- **View:** Leaders  
- **Y:** Interest rate  
- **Density:** Standard or Compact  

**Rationale:** Best product per bank for the current filters.

### Alternative: over time for one term

- **View:** Compare  
- **X:** Collection date | **Group:** Product series  
- **Filters:** One term (e.g. 12 months)  

**Rationale:** "How did 12m rates evolve over time?" for a shortlist.

**Reinvention:** Curve as explicit yield curve; maturity/ladder view; Compare default "same term"; Box default for TD Curve; Leaders by term (tabs or term-on-X). See award-winning-and-reinvention.md.

---

## Summary table

| Section | Primary preset (award-winning default) | Chart type | Alternative "now" | Alternative "over time" |
|---------|--------------------------------------|------------|------------------|-------------------------|
| HL      | Curve, Y=rate or comparison rate      | Line / Box | Leaders          | Compare, X=Date, 1–2 banks |
| Savings | Curve, Y=interest rate                | Line / Box | Leaders          | Compare, X=Date, 1 bank |
| TD      | Curve, Y=interest rate                | Line / Box | Leaders          | Compare, X=Date, filter by term |

---

## Caveats

- Curve style (Line / Ribbon / Box-whisker) applies **only to Curve view**. Other views ignore chart type.
- Section `chartHint` in ar-section-config.js currently describes only time-series (X=Date, Group=Product). Consider adding: "For market shape in one snapshot: use the Curve view."
- Representation (change basis vs daily) affects time-series views and pivot; Curve uses latest snapshot only.
