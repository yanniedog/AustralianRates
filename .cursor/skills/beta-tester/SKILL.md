---
name: beta-tester
---

# Beta Tester

## Overview

Run a human-style, exhaustive website review. Build a coverage inventory first, then manually inspect every reachable page, flow, and important state before writing a detailed report with findings, severity, evidence, and concrete advice.

Read [references/checklists.md](references/checklists.md) before starting the walkthrough. Read [references/report-template.md](references/report-template.md) when writing the output.

## Browser-agent MCP (primary for live QA)

When auditing **Australian Rates** (or any site where this repo’s MCP is enabled), use the **browser-agent** MCP as the **primary** way to traverse pages, exercise flows, and capture evidence. Do not substitute HTML fetch or static guesses for verified layout, interactions, or responsive behaviour when the MCP is available.

| Item | Detail |
|------|--------|
| MCP server (Cursor) | **`browser_agent_cursor`** — see repo `.cursor/mcp.json` (`cwd` → sibling `../browser-agent`; fix path if your checkout layout differs, then reload MCP). |
| One-time setup | In `../browser-agent`: `npm install`, `npx playwright install` (add Firefox/WebKit if you run cross-engine checks). |
| Policy | Repo root **`browser-agent.manifest.json`**: `projectId` **`australianrates`**, allowlisted hosts. In **`session_create`**, pass **`manifestPath`** readable from the browser-agent process cwd (e.g. `../australianrates/browser-agent.manifest.json` when cwd is `browser-agent`). |
| Production URL | **`https://www.australianrates.com`** for verification per project rules. |
| Tool order | `session_create` → `trace_start` → `navigate` / `click` / `scroll` / `wait_for` / … → milestone **`screenshot`** → on failures **`screenshot`**, **`snapshot_dom`**, **`network_capture`**, **`console_capture`** → **`trace_stop`** → **`session_close`**. Preserve **`correlationId`** in the report. |
| Prompts / contract | Sibling **`../browser-agent/cursor-adapter.md`**, **`../browser-agent/ux-browser-runbook.md`**, **`../browser-agent/cursor-ux-skill.md`**. |
| Manifest guard | This project’s manifest may **`block` the `download` tool**; use screenshots and network captures for file/evidence needs. |
| Smoke test | From **australianrates** repo root: **`npm run browser-agent`** (expects `../browser-agent/server.js`). |

**If browser-agent is unavailable** (MCP off, sibling repo missing, or headless environment): say so explicitly in the coverage summary and fall back to **`npm run test:homepage`**, **`npm run audit:visual`**, or HTML-only fetch — and do **not** claim full interactive or visual coverage.

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
