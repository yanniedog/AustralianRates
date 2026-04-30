# Assistant ship closeout (early-stop antidote)

For **Cursor, Codex, Claude**, and similar automation: complements **`AGENTS.md`** with **why** models stop early, **forbidden phrasing**, and **`ship:closeout`** habits.

## Why “PR / CI green” feels like done

Green CI ends a familiar story; **shipping** is merge → deploy → **`verify:prod`** (**AGENTS.md** steps 7–9). **`pr-auto-merge.yml`** can merge on CI alone—still complete **wait gate + threaded replies** (**`.cursor/rules/git-pr-workflow-default.mdc`**) before you enable merge/auto-merge.

## Completion (shipping to www.australianrates.com)

Done only when **AGENTS.md** ship-bar steps **1–9** are satisfied **or** the user **waived a step in writing** (see that doc for commands and exceptions).

**Blocked on merge:** state the blocker; list remaining steps; do **not** imply production updated.

## Forbidden phrasing until step 9 (unless waived)

“Done”, “shipped”, “production updated”, “merge-ready”, “handing off the PR” when you could merge, or “CI green so we’re good.”

## Habit

Before the **final** message on a shipping task: **`npm run ship:closeout`** (repo root). On an **`agent/`**, **`feat/`**, or **`fix/`** branch, run **`npm run ship:closeout:strict`** instead: **exit code 2** means an **open PR** is still on this head (or `gh` is missing in strict mode)—continue **AGENTS.md** steps 5–9; do not claim production is updated.

## Pointers

- **`AGENTS.md`** — authoritative ship bar
- **`.cursor/rules/git-pr-workflow-default.mdc`** — wait gate, bots, exceptions
- **`.cursor/rules/no-early-stop-after-pr.mdc`** — hard guard
- **`docs/CONCURRENT_AGENT_WORKFLOW.md`** — GitHub automation, graph hygiene
