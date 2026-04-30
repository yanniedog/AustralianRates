# Concurrent agents and pull requests

**Repo default for assistants (Cursor, Codex, Claude):** use this PR workflow unless the user explicitly asks otherwise—see root `AGENTS.md` (“Default git workflow”) and `.cursor/rules/git-pr-workflow-default.mdc`.

Use **one Git branch per agent (or per task)**. Open a **pull request (PR)** into `main` for each branch. That keeps work isolated until you deliberately merge, and this repo’s **GitHub Actions CI** already runs on every PR (`ci.yml`).

## GitHub repository settings (one-time, owner)

These settings live in the GitHub web UI and are **not** stored in the repo. They are required for **automatic squash merge** after CI passes.

1. **Settings → General → Pull requests**
   - Turn on **Allow auto-merge**.
   - Turn on **Automatically delete head branches** (removes the remote branch after the PR merges).

2. **Settings → Rules → Rulesets** (or **Branches → Branch protection rules**, depending on org layout) for **`main`**
   - Require status checks to pass before merging.
   - Add required check: **`ci_result`** (the aggregate job in `.github/workflows/ci.yml`).
   - Do **not** require pull request reviews if you want merges to complete without a human approval click (this repo’s automation assumes **CI-only** gating).

Without **Allow auto-merge** and a **required `ci_result`**, the workflow below cannot complete merges by itself.

## Automation: auto-merge and branch cleanup

For **non-draft** pull requests **into `main`** whose head branch starts with **`agent/`**, **`feat/`**, or **`fix/`** (same-repo only, not forks), `.github/workflows/pr-auto-merge.yml` enables **squash auto-merge** on `opened`, `reopened`, `synchronize`, and `ready_for_review`. When **`ci_result`** is green and the PR is mergeable, GitHub merges the PR and, if configured above, **deletes the head branch**. **`main`** stays the single integration branch and source of truth for production. That merge is gated on **CI**, not on third-party review bots—peer-review expectations for bots are in **CI vs PR review bots** below.

- **CI failing:** auto-merge does not complete; fix the branch and push; CI re-runs.
- **Merge conflicts:** resolve by merging or rebasing **`origin/main`** into the PR branch, then push.
- **Draft PRs:** not opted into auto-merge until marked ready for review.

**Stale remote heads (squash merge):** `.github/workflows/stale-branch-cleanup.yml` runs on **every push to `main`**, **weekly** on a schedule, and via **Actions → Stale branch cleanup → Run workflow**. It deletes remote branches named **`agent/*`**, **`feat/*`**, or **`fix/*`** only when there is **no open PR** on that head and **at least one merged PR** used that head—so it clears leftover tips after squash merge without removing branches that never had a merge. It does **not** delete other branch names (for example ad-hoc `chore/` work without a merged PR is untouched unless you rename to match those prefixes).

## CI vs PR review bots (same PR; different gates)

Branch protection + **`ci_result`** control **whether GitHub allows a merge**. **`pr-auto-merge.yml`** triggers squash merge when that gate passes. Third-party review bots are usually **not** registered as required checks—so **CI can go green while bot threads have not even been created yet** (many bots post **after** Actions finish).

**Assistants: hard rule — do not merge immediately when CI passes.** Treating **`gh pr checks --watch` success** as permission to **`gh pr merge`** in the same stretch of work is a **policy violation** unless the human **explicitly waived** bot closeout for that PR.

**Peer-review policy (assistants and humans):** treat bots as reviewers. **Order:**

1. **`ci_result`** green.
2. **Bot feedback wait gate** (full checklist: `.cursor/rules/git-pr-workflow-default.mdc`, **Bot feedback wait gate**): **late-review sweep** (`gh pr view`, UI, or API) for Gemini Code Assist, Copilot, Codex, CodeRabbit, Greptile, Sourcery, etc.; **on github.com**, watch for PR UI cues (reactions/emojis or similar showing a bot review **still in progress**) and wait until those **settle** before calling the gate clear; if no substantive threads yet, **wait ~10–15 minutes** after first green CI and **re-check** (late bot reviews are normal).
3. **Every substantive bot thread:** **in-thread reply** (fix + reply, or reply-only with rationale).
4. **Only then** enable auto-merge or **`gh pr merge --squash`**.

Code-only fixes without replies are **not** sufficient. Skipping (2)–(3) risks merging before bot feedback exists on the PR—or before you have visibly handled it.

**Iterate on the same PR:** When something fails after the PR is open—bot requests, **`ci_result`/checks**, **E2E**, or **deploy/preview/production verification**—commit on the **existing** head branch and push. Avoid opening a **second** PR for the same task unless the maintainer explicitly wants a split. After pushing fixes, leave a PR comment (or in-thread replies) that **@mentions** the bots or reviewers who should run again, using the **same `@username` handles** already visible on that PR (e.g. **Gemini Code Assist**, **GitHub Copilot**, **Codex**, **CodeRabbit**, **Greptile**, **Sourcery**—only those actually installed on the repo).

Canonical wording: `.cursor/rules/git-pr-workflow-default.mdc` (**Bot feedback wait gate**, “PR review bots”, **Same PR for follow-up work**).

## Keeping the Git graph readable (local clones)

Squash merges keep **`main`** linear, but **VS Code Git Graph** (and similar tools) draw one row per **ref** still pointing at old SHAs. After merges, clean up **local** clutter so the graph matches reality:

1. **GitHub (one-time):** enable **Automatically delete head branches** on merged PRs (see **GitHub repository settings (one-time, owner)** above). That removes the remote head immediately when GitHub merges the PR.
2. **After your PR merges (or when the graph looks noisy):** from the repo root run **`npm run git:graph-hygiene`**. It sets **`fetch.prune=true`** for this clone (once), runs **`git fetch origin --prune`**, and deletes **local** branches whose upstream is **`[gone]`** (skipped for any branch checked out in a **worktree** or the current branch).
3. **Delete your finished topic branch locally** if it still exists: **`git branch -d agent/your-topic`** (use **`-D`** only if you understand the branch is disposable).
4. **Avoid duplicate “main” lines:** do not keep a second local branch at the same commit as **`main`** unless you need it (for example two **worktrees** cannot both check out **`main`**—prefer one worktree on **`main`** and another on a **new topic branch** from **`origin/main`**, or stay **detached** at **`origin/main`** instead of inventing alias branch names).

## What a PR is (minimal mental model)

- **Branch:** a parallel copy of the repo history. Commits on branch B do not change branch A until you merge.
- **Pull request:** a request on GitHub to merge branch B into `main` (or another target). It shows the diff, discussion, and CI status.
- **Merge:** when you merge the PR, those commits become part of `main`. Production deploys for this project are typically driven from `main` (Pages + your normal Worker deploy flow).

So multiple agents “do not clash” in Git until the same **lines in the same files** are edited; then Git reports a **merge conflict** you resolve once, usually on the branch that merges last.

## Foolproof routine for each agent

1. **Start from current `main`:**
   - `git fetch origin`
   - `git checkout main`
   - `git pull origin main`
2. **Create a dedicated branch** (pick a unique, descriptive name):
   - `git checkout -b agent/chart-tooltips`  
   Examples: `agent/admin-status-ui`, `feat/pivot-export`, `fix/footer-version`.
3. **Commit only that task’s changes** on that branch; push:
   - `git push -u origin agent/chart-tooltips`
4. **Open a PR** targeting `main` (GitHub website: “Compare & pull request”, or CLI):
   - `gh pr create --base main --title "..." --body "..."`
5. **`ci_result`** green on the PR (`.github/workflows/ci.yml`). Then complete the **Bot feedback wait gate** (late sweep + ~10–15 minute wait/re-poll) and threaded replies (`docs/CONCURRENT_AGENT_WORKFLOW.md`, **CI vs PR review bots**): **do not** merge or mark merge-ready solely because CI passed.
6. For **`agent/`** / **`feat/`** / **`fix/`**, **`pr-auto-merge.yml`** may enable **squash auto-merge** when the PR is not a draft; GitHub merges when **`ci_result`** passes, **not when bots finish**. Enable auto-merge **only after** step 5 (wait gate **and** replies) is satisfied. If auto-merge was already on while bot feedback was pending, disable it until replies are done (push fixes first if needed).
7. Optionally **`gh pr merge --auto --squash`** after create if you need auto-merge before the workflow runs; otherwise rely on **`pr-auto-merge.yml`**. Prefer merging one PR before starting heavy overlap on the same files in another branch, or rebase/merge `main` into the other branch before merge.

## Reducing clashes between agents

- **Split ownership by area** when possible: e.g. one agent on `site/`, another on `workers/api/`, another on `workers/archive/`. The CI job already classifies paths; unrelated areas merge cleanly most of the time.
- **Avoid shared hotspots** in parallel (e.g. the same giant `site/*.js` file): serialize those tasks or have one agent finish and merge first, then the next rebases or merges `main`.
- **Do not share one branch** between two agents unless they coordinate; two writers on one branch cause confusing history and forced pushes.

## Testing impact on the “deployed” site before other agents finish

Interpretation matters:

| What changed | How to preview before merging to `main` |
|--------------|----------------------------------------|
| **Frontend (`site/`, build, stamps)** | **Cloudflare Pages preview deployments:** if your Pages project builds previews for non-production branches, each push to the feature branch produces a **`*.pages.dev` (or project preview) URL**. Use that URL to exercise the static UI. This repo’s frontend **defaults to calling the production API** from the browser, so preview UIs often still hit `https://www.australianrates.com` for data unless you change API base for local/preview testing (see `README` / test env vars). That is usually desirable for “how does this UI behave against real data?” |
| **API or archive Workers** | PR CI runs **unit/integration** checks; **production API behaviour** only changes after **`npm run deploy:api`** / **`npm run deploy:archive`** (or your pipeline) against the real Worker. There is no second public production API in-repo; staging Workers are optional and would be a separate Wrangler environment/name if you add them. |
| **Full stack together** | After merge to `main` and normal deploy, run the repo’s production verification commands from root (see `AGENTS.md`). Default to `npm run verify:prod -- --scope=auto --depth=smoke`; use `npm run verify:prod -- --scope=full --depth=full` for shared/tooling/workflow changes or explicit full sign-off. **GitHub Actions does not replace** live production checks where Cloudflare bot challenges block headless runners; run them from a real machine after deploy. |

So: **parallel frontend experiments** map well to **branch + PR + Pages preview**. **Parallel API experiments** are validated in CI on the PR; true production impact still follows your deploy discipline after merge.

## Rolling work together

- **One agent finishes first:** merge that PR to `main`. Other agents run `git fetch origin && git merge origin/main` (or `git rebase origin/main`) on their branch, fix any conflicts, push, and continue.
- **Several PRs ready at once:** merge in any order; if CI breaks on `main`, fix forward with a small follow-up PR or update the open branch and merge again.
- **Squash vs merge commit:** team preference. Squash keeps `main` linear; merge commits preserve branch boundaries. Either is fine if you are consistent.

## Quick GitHub CLI cheatsheet (`gh`)

Install: see [GitHub CLI](https://cli.github.com/). Authenticate once: `gh auth login`.

```bash
gh pr list
gh pr view 123 --web
gh pr checks watch 123
gh pr merge 123 --squash   # or --merge
```

## Optional: git worktrees (two working folders, one clone)

If *you* run two agents locally without two full clones:

```bash
git fetch origin
git worktree add ../australianrates-task-b origin/main
cd ../australianrates-task-b
git checkout -b agent/task-b
```

Each worktree is an independent checkout; pushes still go to the same remote.

## Summary

- **One branch per agent/task, one PR each into `main`.**
- **`ci_result`** guards merges mechanically; **PR review bots** need **replies on the PR** per policy **before** enabling auto-merge (see **CI vs PR review bots**).
- **Auto-merge (squash) + delete head branch** (when configured on GitHub) reduce leftover open PRs and remote branches for **`agent/`**, **`feat/`**, **`fix/`** PRs.
- **`stale-branch-cleanup.yml`** runs on **pushes to `main`**, **weekly**, and manually; it catches remote **`agent/`** / **`feat/`** / **`fix/`** heads left behind after merged PRs if automatic deletion was off.
- **`npm run git:graph-hygiene`** (after merges) trims **local** stale refs so Git Graph stays accurate.
- **Preview the static site** via Cloudflare Pages branch previews when enabled; **production** remains `https://www.australianrates.com` after `main` deploys.
- **Merge + update other branches from `main`** to roll work together safely.
- **Post-merge:** agents still run production verification from the repo root (`AGENTS.md`); CI green is not a substitute for live-site checks where Playwright cannot pass in the cloud.
