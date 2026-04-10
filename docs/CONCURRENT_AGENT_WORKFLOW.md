# Concurrent agents and pull requests

Use **one Git branch per agent (or per task)**. Open a **pull request (PR)** into `main` for each branch. That keeps work isolated until you deliberately merge, and this repo’s **GitHub Actions CI** already runs on every PR (`ci.yml`).

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
5. **Wait for CI green** on the PR (required jobs in `.github/workflows/ci.yml`).
6. **Merge** when you are satisfied (`gh pr merge` or the Merge button). Prefer merging one PR before starting heavy overlap on the same files in another branch, or rebase/merge `main` into the other branch before merge.

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
| **Full stack together** | After merge to `main` and normal deploy, run the repo’s production verification commands from root (see `AGENTS.md`). |

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
- **CI already guards PRs** in this repo.
- **Preview the static site** via Cloudflare Pages branch previews when enabled; **production** remains `https://www.australianrates.com` after `main` deploys.
- **Merge + update other branches from `main`** to roll work together safely.
