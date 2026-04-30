# Concurrent agents and pull requests

**Canonical policy:** `AGENTS.md` (ship bar), `.cursor/rules/git-pr-workflow-default.mdc` (branch/PR routine, **Bot feedback wait gate**, PR review bots). **Why assistants stop early:** `docs/ASSISTANT_SHIP_CLOSEOUT.md`, `npm run ship:closeout`.

One **branch per task/agent**, one **PR to `main`**. CI: `.github/workflows/ci.yml` (`ci_result`).

## GitHub settings (owner; not in repo)

1. **Settings → General → Pull requests:** Allow **auto-merge**; **Automatically delete head branches**.
2. **Rulesets / branch protection for `main`:** Require **`ci_result`**. Omit required human reviews if merges should be CI-gated only.

Without auto-merge + required **`ci_result`**, the automation below cannot self-complete.

## Automation

- **`pr-auto-merge.yml`:** For PRs **into `main`** from heads matching **`agent/*`**, **`feat/*`**, **`fix/*`** (same repo, non-draft): enables squash auto-merge on open/reopen/sync/ready. Merge runs when **`ci_result`** is green—**bots are not in that gate**. **Do not** turn on auto-merge until the **wait gate + in-thread replies** in **`.cursor/rules/git-pr-workflow-default.mdc`** are done.
- **`stale-branch-cleanup.yml`:** On push to **`main`**, weekly, or manual—deletes remote **`agent/*`** / **`feat/*`** / **`fix/*`** with no open PR but a prior merge from that head.

## CI vs review bots

**Mechanical gate:** **`ci_result`**. **Policy gate:** substantive bot/human threads need **in-thread replies** before merge/first-time auto-merge. Bots often comment **after** Actions finish—the full sweep, UI settle check, ~10–15 minute re-poll, and reply rules live only in **`.cursor/rules/git-pr-workflow-default.mdc`** (do not duplicate here).

Fix forward on the **same** PR branch; discover `@handles` via `gh pr view -c`.

## Graph hygiene (local)

After merge: `npm run git:graph-hygiene`; `git branch -d agent/...` when safe. Prefer GitHub **delete head branches**. Avoid extra local refs at the same commit as **`main`** unless worktrees require it.

## Per-agent routine (short)

`git fetch origin && git checkout main && git pull` → `git checkout -b agent/<slug>` → commit → `git push -u origin HEAD` → `gh pr create --base main` → green **`ci_result`** → **wait gate + replies** (`.cursor/rules/git-pr-workflow-default.mdc`) → merge → **`npm run git:graph-hygiene`**.

Before push/merge: `git fetch origin && git diff origin/main...HEAD --stat`; resolve clashes with **`origin/main`** and other **`agent/*`** branches when needed.

## Parallel work / previews

Split by directory when possible; serialize edits to the same hot files.

| Changed | Preview / truth |
|---------|----------------|
| **`site/`** etc. | Pages branch preview URLs; browser still often calls production API unless overridden. |
| **Workers** | PR CI validates code; production behaviour changes after **`npm run deploy:api`** / **`deploy:archive`**. |
| **Shipped stack** | After **`main`** deploy: `npm run verify:prod -- --scope=auto --depth=smoke` from a capable machine (`AGENTS.md`). |

Roll forward: merge one PR → others `git merge origin/main` or rebase → fix conflicts → push.

## `gh` quick refs

```bash
gh pr list
gh pr view 123 --web
gh pr checks 123 --watch
gh pr merge 123 --squash
```

## Worktrees (optional)

```bash
git fetch origin
git worktree add ../australianrates-b origin/main
cd ../australianrates-b && git checkout -b agent/task-b
```
