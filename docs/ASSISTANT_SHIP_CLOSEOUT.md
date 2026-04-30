# Assistant ship closeout (why “early stop” happens and how to prevent it)

This doc is for **Cursor, Codex, Claude, and any automation** working in this repo. It complements **`AGENTS.md`** (ship bar) with a short **root-cause analysis** and a **hard completion definition**.

## Why mistakes keep happening

1. **Natural LLM stopping point** — Investigation, code fix, push, and “CI passed” feel like a finished story. The model gets **reward signal** from delivering a PR link. Policy correctly says the job continues through **merge, deploy, and production verify**, but that lives in **long** rule text spread across several files, so it loses to the default “handoff” reflex.

2. **“Hand off the PR” wording** — Any instruction that says “give the user the PR URL” without **explicitly** saying “only if merge is blocked” reads like **stop here**. That accidentally trains early exit.

3. **`ci_result` green and auto-merge** — This repo can **merge from automation when CI is green**. Policy still requires **bot wait gate + threaded replies before first-time auto-merge** so CI does not close the loop before review bots. Assistants sometimes conflate **GitHub mergeability** with **policy-complete**.

4. **Scope ambiguity** — “Fix the bug” is read as **code done** not **users see it on www**. Shipping must include **production verification** unless the user **waives in writing**.

5. **Context pressure** — Late steps (wait 10–15 minutes, re-sweep PR, merge, wait for Pages, run Playwright smoke) are **expensive in time/tokens**. Models truncate the plan unless the **forbidden phrases** below are internalized.

## Completion definition (shipping work)

For any change intended to reach **https://www.australianrates.com**, you are **not done** until **all** of the following are true **or** the user **explicitly waived** a step in writing for **that** task:

| Step | Gate |
|------|------|
| 1 | Branch off fresh `origin/main` (unless user ordered `main` hotfix) |
| 2 | Commit + push to that branch |
| 3 | PR to `main` open |
| 4 | Required CI green (`ci_result`, etc.) |
| 5 | **Bot wait gate:** late sweep + ~10–15 minute re-poll unless waived |
| 6 | **Every substantive bot/human thread:** in-thread reply (implemented / deferred / declined) |
| 7 | **Merge** to `main` (no “CI green = I’m finished” before 5–6 unless waived) |
| 8 | **Deploy finished** (Pages / Workers as applicable) |
| 9 | **`npm run verify:prod -- --scope=auto --depth=smoke`** (or broader per `AGENTS.md`) **exit 0** |

If you **cannot** merge (permissions, user approval only): say so, list **exact** remaining steps, and do **not** imply production is updated.

## Forbidden until step 9 (or waiver)

Do **not** use task-complete language such as:

- “The fix is done” / “task complete” / “shipped” / “production updated”
- “Handing off to you to merge” **when you have merge rights and no blocker**
- “CI is green so we’re good” / “merge-ready” (policy: **not** merge-ready until wait gate + replies)

**Allowed** before merge: “PR is open, CI is green; next I’m running the bot wait gate and threaded closure, then merge and verify:prod.”

## Mechanical habit

Before the **final** assistant message on a shipping task, run from repo root:

```bash
npm run ship:closeout
```

It prints the checklist and, if `gh` is available, warns when your **current branch** still has an **open** PR (you probably stopped before merge).

## Canonical references

- **`AGENTS.md`** — Ship bar (steps 1–9)
- **`.cursor/rules/git-pr-workflow-default.mdc`** — Bot wait gate, PR review bots
- **`.cursor/rules/no-early-stop-after-pr.mdc`** — Hard “do not stop at PR” rule for assistants
- **`docs/CONCURRENT_AGENT_WORKFLOW.md`** — CI vs review bots, auto-merge caveat
