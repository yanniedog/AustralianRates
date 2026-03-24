# Outlier products in admin XLSX exports

This checklist describes **products and row types** that skew min/max, means, or time-series charts when mixed with mainstream retail products. Regenerate numbers with:

`node analyze-export-xlsx.js`

(Requires `*.xlsx` files in this folder; files are gitignored.)

## Home loans

| Risk | Examples | Why it skews results |
|------|----------|----------------------|
| Ultra-low niche / concessional | Westpac Flexi First Option Home Loan – **Veterans** (~3.25%) | Sets global minimum; not comparable to standard variable |
| Sustainability-linked low | Westpac **Sustainable Upgrades** Home / Investment Loan (~3.99%) | Same as above |
| Short-term / IO / specialty high | Bendigo **Bridging** Home Loan (~9.79% IO); Suncorp **Standard Variable Rate**; NAB **FlexiPlus Mortgage**; HSBC **Home Equity – Reference Rate** | Bridging/LOC/reference behaviour vs long-term P&I |
| Spiky longitudinal series | Great Southern **Offset Variable** / **Basic Variable** (large min–max spread on one `product_key`) | Discount/reprice noise in a single key |
| Missing comparison rate | Rows with blank `comparison_rate` (often `cdr_live`) | Breaks metrics that require comparison rate |

## Savings

| Risk | Examples | Why it skews results |
|------|----------|----------------------|
| Structural 0% | AMP GO Everyday; ANZ Business Essentials / Business Online Saver; many transaction-style accounts | Anchors distribution at zero |
| High tail (legitimate) | Bankwest Easy Saver; BOQ Future Saver; ING Savings Maximiser; Macquarie Savings | Drives upper quantiles |
| Wrong section / FX | Great Southern **Term Deposit** 1–2 months in savings feed; CBA **Foreign Currency** Account | Not comparable to AUD at-call savings |
| Volatile tiers | Suncorp Business Premium Account (wide spread) | Jumping series if tiers not split |

## Term deposits

| Risk | Examples | Why it skews results |
|------|----------|----------------------|
| Placeholder / tiny tier 0% | BOQ **Farm Management Deposit – Fixed** on `$1–$999` tier | Many 0% rows; not retail head rates |
| Farm / agri wide spread | Bendigo **Fixed Rate Farm Management Deposit** | Negotiated or tier-heavy |
| Short term noise | GSB 1m / 2m TDs; St.George / Bank of Melbourne TDs with **0.1%** floor rows | Extreme quantiles across terms |
| High tail | AMP Bank GO 6m/12m TDs (~5.2%) | Upper range of file |

## Default views

For “typical consumer” comparisons, consider filtering or tagging: transaction accounts (0%), bridging/LOC, farm placeholder tiers, FX products, and mis-filed TD rows in savings exports.
