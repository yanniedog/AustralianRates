# Award-winning bar and reinvention playbook

Use this when the agent must think deeply, be creative, and propose changes that would make Australian Rates charts **literally award-winning** (Malofiej, Kantar, Information is Beautiful, SND). The goal is to **reinvent** the data visualisation, not only optimise current views.

---

## What award juries and critics look for

- **Clarity of the one thing:** The viewer gets one sharp question answered in under 10 seconds. No "dashboard soup."
- **Surprise or insight:** The viz reveals something not obvious from the table (e.g. shape of the curve, who crosses whom over time, spread vs median).
- **Data-ink ratio (Tufte):** Every pixel earns its place. Remove grid lines, redundant labels, and decoration that don't carry information.
- **Narrative:** There is a visual story (e.g. "variable is here, fixed terms step up, 5y is highest" or "this bank leads at 12m but not at 24m").
- **Honest representation:** No truncated axes that exaggerate difference; no continuity where product_key changes. Comparison rate vs headline clearly distinguished.
- **Memorability:** Layout, colour, or composition make the chart recognisable and scannable (e.g. curve shape, leader bar order, spotlight panel).
- **Accessibility and universality:** Works in light/dark, at small size, with keyboard and screen reader; colour is not the only channel.
- **Craft:** Typography, alignment, spacing, and interaction feel intentional, not default.

---

## Reinvention mindset

- **Challenge defaults:** "Why a line? Why a bar? What if the primary object were the spread, or the delta, or the rank?"
- **Combine views:** Could Curve and Leaders be one composition (e.g. curve with leader dots, or small-multi leaders by structure)?
- **Add meaning, not decoration:** Annotations (e.g. "RBA cut", "last change", "you are here") that are data-driven and sparse.
- **Reduce steps:** Can the user answer "who's best at 2y fixed?" in one view without switching view or filter?
- **Invent new encodings:** Consider slope graphs for before/after, horizon charts for many series, connected scatter for rate vs fee, or a "rate ladder" that is both rank and value.
- **Section as story:** HL = "borrowing cost by commitment"; Savings = "reward by balance and behaviour"; TD = "yield by time and size." Design the chart that tells that story in one frame where possible.

---

## Deep principles (think before drawing)

1. **One series = one product over time (product_key).** Never imply continuity across different products. This is non-negotiable.
2. **Rate is the hero; structure/term/tier is the stage.** The Y (rate) should dominate; the X (structure/term/tier or date) should organise. Avoid equal visual weight for axes when one is the "answer."
3. **Comparison rate exists to level the playing field.** When comparing HL products, comparison rate is often the honest metric; headline rate is the hook. Make the choice explicit and default to the one that supports comparison when the view is comparative.
4. **Density is a design lever.** "Compact" can feel focused and award-friendly; "expanded" can feel comprehensive but noisy. Prefer fewer, ranked series with a "see more" path over showing everything.
5. **Colour is semantic.** Same colour = same meaning (e.g. one bank one colour across Curve and Compare). Use section palettes; avoid one-off colours. Reserve emphasis colour for spotlight or delta.
6. **Time needs a clear zero or baseline.** For time-series, aligned time axis and optional "change from" or "vs cash rate" can make the story clearer.
7. **Mobile is not desktop shrunk.** On small screens, consider one question per screen, bigger touch targets, and a "key insight" line above the chart.

---

## Reinvention ideas by section

### Home Loans (HL)

- **Unified "cost landscape":** One view: X = rate structure (variable → 5y), Y = rate, with bank curves + a distinct "market median" or "RBA + spread" reference line. Click a bucket to see leaders at that structure. Reduces "view then click then view."
- **Headline vs comparison toggle with clear labelling:** E.g. "Show: Headline rate | Comparison rate (like-for-like)" so the user knows what they're comparing. Default Curve to comparison rate when slice is comparative (e.g. one purpose, one repayment).
- **Delta or "vs last month" encoding:** For Movement or Compare, allow a secondary encoding (colour intensity, dot size, or small sparkline) for change from previous period so "who moved" is visible without a second chart.
- **LVR/Purpose as small multiples:** If data allows, one Curve per LVR or Purpose (e.g. 2×2 grid) instead of forcing filter-first. "At a glance: OO P&I vs Inv IO."
- **Annotation layer:** Data-driven annotations (e.g. "RBA meeting", "last change date") from a small, authoritative set; no clutter.
- **Leaders rethought:** Bar chart is clear; consider adding a tiny trend (up/down arrow or mini sparkline) so "best now" also hints "moving how?"

### Savings

- **Curve as "reward by balance":** Frame the Curve explicitly as "Rate by deposit tier" when that dimension is chosen; label axes "Balance tier" and "Rate (%)" so the story is "put more in, get more (or not)."
- **Bonus vs base emphasis:** Where rate_type varies, consider visual distinction (e.g. dashed for bonus, solid for base) so "conditional" vs "unconditional" is visible.
- **Distribution by bank as the "spread story":** Position Distribution view as "Which bank gives the most consistent rates across products?" Box-whisker by bank; optional "best median" or "tightest spread" highlight.
- **One product over time with context:** Compare view: add a subtle "market average at this date" or "best-in-class at this date" so the user sees their product vs the field over time.
- **Savings-specific annotation:** E.g. "Intro period ends" or "Bonus conditions" where data exists; keep annotations sparse and factual.

### Term Deposits (TD)

- **Curve as yield curve:** Name and frame it explicitly: "Term structure" or "Yield by term." Axis label "Term" with months or "3m | 6m | 12m | 24m" so it reads like a bond curve.
- **Maturity calendar or ladder:** Optional view or annotation: "If you lock 12m today, maturity date is X." Supports "when do I get my money back?"
- **Compare filtered by term:** Default or prompt "Compare products at same term" so lines are comparable (all 12m or all 24m); avoid mixing terms in one Compare chart unless explicitly requested.
- **Spread at term as the story:** Box-whisker at each term answers "at 12m, how much do rates vary across banks?" Consider making that the default Curve style for TD (box) with line as option.
- **Term as the primary dimension:** In Leaders, consider "Best at 3m | 6m | 12m | 24m" tabs or a single chart with term on X and bank as lines, so "who leads where" is one view.

---

## Novel chart types to consider (if building new)

- **Slope graph:** Two time points (e.g. 90 days apart); each product is a line from (t1, rate1) to (t2, rate2). Shows "who moved up/down" vividly.
- **Horizon chart:** Many series stacked; bands show positive/negative change from baseline. Saves vertical space for "many products over time."
- **Connected scatter:** X = one metric (e.g. rate), Y = another (e.g. fee); points move over time. For HL: rate vs fee over time.
- **Rate ladder (rank + value):** Vertical rank order (1, 2, 3…) with rate on the same row; updates by slice. Combines "who's first" with "by how much."
- **Small multiples:** One small chart per segment (e.g. per term, per structure); same scale so comparison is easy. Reduces interaction cost.
- **Annotation-first minimal chart:** One number or one curve with one key annotation (e.g. "Best 12m TD: X% at Bank Y") and a "see full chart" affordance. For mobile or hero moments.

---

## Output when recommending reinvention

1. **Current state (one line):** What the existing view does.
2. **Award gap:** What's missing (clarity, surprise, narrative, data-ink, accessibility).
3. **Reinvention idea:** Concrete change (new view, combined view, new encoding, annotation, or default).
4. **Rationale:** Why it would raise the bar toward award-winning.
5. **Implementation note:** Where in code or config it would land, or "new component/API required."

Use this playbook whenever the user asks to "smash it," "reinvent," or make viz "literally award-winning."
