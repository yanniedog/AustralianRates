# Assistant ship closeout (early-stop antidote)

For **Cursor, Codex, Claude**, and similar automation: complements **`AGENTS.md`** with **why** models stop early and a **minimal completion checklist**.

## Why “PR / CI green” feels like done

Investigation → fix → push → green CI matches a natural narrative; **shipping** continues through merge, deploy, and **`verify:prod`**. **`pr-auto-merge.yml`** can merge on CI alone—policy still requires **wait gate + threaded replies** before you enable merge/auto-merge (**`.cursor/rules/git-pr-workflow-default.mdc`**). Scope phrases like “fix the bug” are often read as code-done, not **users see www**.

## Completion (shipping to www.australianrates.com)

Finished only when **all** apply **or** the user **waived that step in writing**:

| Step | Gate |
|------|------|
| 1–3 | Branch from `origin/main` → commit + push → PR to `main` |
| 4 | **`ci_result`** green (fix on same PR branch) |
| 5–6 | **Wait gate + in-thread replies** per **`.cursor/rules/git-pr-workflow-default.mdc`** |
| 7 | **Merge** to `main` |
| 8 | **Deploy finished** (Pages / Workers as applicable) |
| 9 | **`npm run verify:prod -- --scope=auto --depth=smoke`** exit **0** (or broader per **`AGENTS.md`**) |

**Blocked on merge:** state the blocker; list remaining steps; do **not** imply production updated.

## Forbidden phrasing until step 9 (unless waived)

“Done”, “shipped”, “production updated”, “merge-ready”, “handing off the PR” when you could merge, or “CI green so we’re good.”

## Habit

Before the **final** message on a shipping task: **`npm run ship:closeout`** (repo root).

## Pointers

- **`AGENTS.md`** — authoritative ship bar
- **`.cursor/rules/git-pr-workflow-default.mdc`** — wait gate, bots, exceptions
- **`.cursor/rules/no-early-stop-after-pr.mdc`** — hard guard
- **`docs/CONCURRENT_AGENT_WORKFLOW.md`** — GitHub automation, graph hygiene
