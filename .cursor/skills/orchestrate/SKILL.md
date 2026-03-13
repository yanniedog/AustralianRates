---
name: orchestrate
description: Orchestrates multiagent workflows with a team of elite coders embodying diverse expertise (front-end, UX, backend, Cloudflare, cost, security, visual design, business, maintainability, and more). Splits tasks into phases, delegates to specialist subagents (explore, generalPurpose, shell, deploy-verify-loop, refactor-guardian, smart-refactor), requires consideration from multiple perspectives in handoffs and final summary, and reports verification evidence. Use when the user invokes /team or when a task has distinct phases that benefit from specialists; for single-step tasks, do the work yourself.
---

# Orchestrate

Run as the orchestrator of a multiagent workflow staffed by a **team of elite coders with a wide and diverse range of cutting-edge expertise**. Use when the task has distinct phases (discovery, implementation, testing, deployment, or refactoring) that benefit from specialist subagents. For single-step tasks (e.g. one file edit, one command), do the work yourself; do not spawn subagents. Every task must be considered from the expertise dimensions below where relevant; include them in handoffs and in the final summary.

## Team expertise and perspectives

The team embodies expertise across (but not limited to) these dimensions. When splitting work, writing handoffs, and summarizing, consider the task from as many of these as are relevant:

- **Front end** – UI implementation, client-side behaviour, compatibility.
- **User experience (UX)** – Ease of use, clarity, flow, accessibility.
- **Back end** – APIs, data model, performance, correctness.
- **Cloudflare** – Account resources (Workers, D1, R2, Queues, Pages), limits, and configuration.
- **User retention and engagement** – Why users return, value delivered, stickiness.
- **Browser and device** – Ease of use from a browser perspective; desktop vs smartphone; responsive behaviour.
- **Usefulness** – Whether the feature or change actually serves user or business needs.
- **Maintainability** – Coding best practice, readability, DRY, single responsibility; refactor so no code file exceeds 500 lines where appropriate.
- **Marketing** – Messaging, positioning, clarity of value proposition.
- **Business** – Moat, short- and long-term profitability, strategic fit.
- **Cost** – Minimising cost, especially Cloudflare (Workers invocations, D1/R2 usage, egress).
- **Data security** – Handling of sensitive data, least privilege, exposure risks.
- **Visual and layout** – Text visibility on background colour, crowding of elements, hierarchy, spacing.
- **Responsive and viewport** – How the site appears on desktop and smartphone; breakpoints and touch targets.
- **Style and design** – Design best practices; alignment with current award-winning website patterns where applicable.
- **Other dimensions** – Any other perspective that would improve quality, sustainability, or outcome.

In handoffs, ask specialists to consider the task from the perspectives that apply to their subtask. In the final summary, include a **Perspectives considered** pass: which dimensions were relevant, what was checked, and any findings or recommendations (e.g. Cloudflare cost impact, UX note, security consideration, file length).

## 1. Load project rules

Read AGENTS.md and always-applied rules in .cursor/rules (e.g. fix-commit-verify-loop, deployment, no-mock-test-data). Use them in every handoff and in the final verification step.

## 2. Commit–sync–verify loop (mandatory when there are changes)

When the task results in **code or config changes** (or when deploy or production is involved), the workflow **must always** run this loop and **iterate until everything is fixed**:

1. **Git commit** – Stage and commit all relevant changes with a clear message.
2. **Git sync** – Push to the remote (e.g. `git push` or "Sync" so the site deploys).
3. **Test the deployed site** – Run the project's test commands against the deployed site (e.g. `npm run test:homepage`, `npm run test:api`, `npm run test:archive` from AGENTS.md or deployment rules).
4. **Iterate** – If any check fails, fix the cause, then repeat from step 1. Do not consider the task complete until this loop has been run and all checks pass.

Use the **deploy-verify-loop** subagent to run this loop, or run it yourself (e.g. via shell) when you have production-affecting changes. Never present an assumption as a completed verification.

## 3. Split the task

Break the request into clear subtasks (e.g. explore codebase, implement changes, run tests, deploy, verify on production, refactor). If the user mentions deploy, production, or fixing the live site, one subtask must be "deploy and verify on production" and the deploy-verify-loop handoff must include: production URL, test commands from project config, and "do not mark complete until these checks pass."

## 4. Delegate to specialists

Assign each subtask to the right subagent:

- **explore**: Fast codebase search, "where is X?", "what uses Y?", tracing references.
- **generalPurpose**: Deeper research, multi-step design or implementation, or when the task doesn't fit explore/shell.
- **shell**: Git, npm, wrangler, builds, tests, commits, terminal verification.
- **deploy-verify-loop**: Run the **commit–sync–verify loop**: git commit, git sync (push), test the deployed site (project test commands against production), then fix and repeat until all checks pass. Pass project rules and explicit test commands + production URL in the handoff. Do not mark complete until the loop has succeeded.
- **refactor-guardian** / **smart-refactor**: When the task is about structure, modularity, file size, or cross-file cleanup.

## 5. Order and parallelism

Run dependent steps in order; wait for each result before starting the next. For independent subtasks (e.g. explore two different areas), launch subagents in parallel (max 4 concurrent). Default sequence when unsure: explore first, then generalPurpose or direct implementation, then shell, then **commit–sync–verify loop** (via deploy-verify-loop or shell) when the change affects production or results in commits.

## 6. Handoffs

For every delegation, include: user goal, repo constraints (or "see AGENTS.md and .cursor/rules"), files/subsystems to inspect, previous specialists' findings, exact deliverable expected, and—where relevant—**which expertise perspectives to consider** (e.g. "consider from UX, Cloudflare cost, and mobile layout"). Use the Team expertise and perspectives list above; name the dimensions that apply to that subtask. Keep handoffs short but self-contained.

When a specialist (or the orchestrator) saves any document file—e.g. a critique, report, or generated deliverable—they **must** give the **exact complete raw path** to that file in their response (e.g. absolute path like `c:\code\australianrates\docs\admin-export-critique.md` or repo-root path like `docs/admin-export-critique.md`). Include this requirement in handoffs when the deliverable is a saved document.

## 7. Summarize

Report in four parts:

1. **What was done** – Outcome and changes.
2. **What each specialist returned** – Key findings and deliverables.
3. **What failed or remains** – Any failures or follow-up work.
4. **Perspectives considered** – For each expertise dimension that was relevant to the task (from the Team expertise list), briefly note what was checked and any findings or recommendations (e.g. "Cloudflare cost: no new D1 reads in hot path"; "UX: CTA visible on mobile"; "Maintainability: new file 120 lines"; "Security: no PII in new endpoint"). Surfaces the elite-team review across front end, UX, backend, Cloudflare, cost, security, visual, business, maintainability, and other dimensions.

For deploy-related work, include verification evidence in part 1 or 2: exact commands run, exit codes, and pass/fail summary; never present an assumption as a completed verification.

When any document was saved (e.g. a critique, report, or generated deliverable), the summary **must** include the **exact complete raw path** to that file (e.g. `c:\code\australianrates\docs\admin-export-critique.md` or `docs/admin-export-critique.md`).

---

This skill is available in chat as **/team**.
