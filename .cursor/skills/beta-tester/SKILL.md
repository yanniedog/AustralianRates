---
name: beta-tester
description: Manual, methodical site QA, UX review, product critique, and improvement advice for websites and web apps. Use when Cursor is asked to beta test a site, go through the whole site, click through every reachable page or flow, produce a detailed bug report, evaluate polish/usability/content/accessibility, or recommend improvements after hands-on inspection.
---

# Beta Tester

## Overview

Run a human-style, exhaustive website review. Build a coverage inventory first, then manually inspect every reachable page, flow, and important state before writing a detailed report with findings, severity, evidence, and concrete advice.

Read [references/checklists.md](references/checklists.md) before starting the walkthrough. Read [references/report-template.md](references/report-template.md) when writing the output.

## Audit Workflow

1. Define the target.
   - Confirm the environment, base URL, and whether login or special roles exist.
   - State any tool limits that affect coverage.
2. Build the inventory before judging the site.
   - Discover URLs from navigation, footer, sitemap, robots, internal links, XML feeds, search, forms, and obvious alternate states.
   - Treat "every part of the site" literally: include happy paths, empty states, error states, validation states, responsive layouts, and major user journeys.
3. Traverse the site methodically.
   - Visit each page and flow instead of sampling.
   - Use desktop and mobile layouts at minimum when possible.
   - Revisit shared components in context if they behave differently by page or breakpoint.
4. Evaluate each stop with the checklist.
   - Check functionality, copy, layout, navigation, trust signals, accessibility, performance clues, SEO basics, and overall product clarity.
   - Record evidence while testing instead of relying on memory.
5. Produce a detailed report.
   - Summarize coverage first.
   - List findings by severity with exact URLs, repro steps, observed behavior, impact, and recommended fixes.
   - Separate bugs from improvement ideas.
6. State coverage gaps explicitly.
   - Call out blocked routes, auth-only areas, inaccessible states, and anything not actually tested.

## Working Rules

- Prefer direct inspection over assumptions.
- Do not claim full coverage unless you enumerated and visited the reachable inventory.
- Do not hide uncertainty. If a section could not be reached, say so.
- Do not stop at bugs. Also evaluate clarity, friction, trust, consistency, and missed opportunities.
- Give actionable advice. Replace vague comments with concrete changes.
- Be demanding but fair. Focus on user impact, not personal taste.
- If screenshots or captures are possible in the environment, collect them for important findings.

## What Good Output Looks Like

Include:

- Coverage summary: what was tested, on which breakpoints or devices, and what remained untested
- Findings: severity, URL/location, title, evidence, repro steps, impact, recommendation
- Improvement ideas: UX/content/conversion/accessibility/performance suggestions even where nothing is "broken"
- Themes: repeated patterns across pages that indicate systemic issues
- Priority guidance: what to fix first and why

Avoid:

- Generic praise with no evidence
- One-line bug lists with no repro or impact
- Advice that depends on unstated assumptions
- Mixing verified defects with speculation

## References

- Use [references/checklists.md](references/checklists.md) for discovery, traversal, and evaluation criteria.
- Use [references/report-template.md](references/report-template.md) for the final structure and finding format.
