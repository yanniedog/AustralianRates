# Codex (OpenAI) — Australian Rates

Read **`AGENTS.md`** and **`CLAUDE.md`** at repo root for commands, verification, and presentation rules.

## Ship bar (complete inline — do not stop early)

All 9 steps are required unless the user explicitly waives that step in writing for that PR.

### 1 — Branch

```sh
git fetch origin && git checkout main && git pull origin main
git checkout -b agent/<topic-slug>    # or feat/ or fix/
```

Distinctive slug (topic + short nonce like `-kj1` for generic topics). Never reuse another agent's in-flight branch.

### 2 — Commit + push

Commit only on the topic branch. `git push -u origin HEAD`.

### 3 — PR

`gh pr create --base main`. One PR per deliverable. Fix-ups stay on the same branch — do NOT open a second PR.

### 4 — CI green

`gh pr checks <n> --watch` until `ci_result` passes. Fix forward on this PR. After fix pushes, `@mention` reviewers using handles from `gh pr view -c`.

### 5 — Wait gate (hard; never skip)

**Do NOT merge in the same breath as CI green. Stop. Then:**

a. Run `npm run wait-for-bots` — exits 2 with time remaining if < 20 min since `ci_result` green. Do not proceed until it exits 0.
b. `gh pr view <n> --comments`
c. `gh api repos/<owner>/<repo>/pulls/<n>/reviews`
d. `gh api repos/<owner>/<repo>/pulls/<n>/comments`
e. On github.com: scan Conversation + Files until in-flight bot activity settles.
f. Note all bots that commented after your last push: Gemini Code Assist, Codex, Copilot, CodeRabbit, Greptile, Sourcery, security scanners.

**The 20-minute minimum wait is unconditional — even when early threads exist. Bots post in waves; early threads do not mean all bots have finished.**

### 6 — Thread closure (hard; never skip)

For every substantive thread (bot or human): enumerate → judge → reply in-thread on GitHub:

- **Implemented:** reply with SHA.
- **Deferred:** reply with reason.
- **Declined:** reply with concrete reason (out of scope, conflicts with `AGENTS.md`, etc.).

Do NOT merge with unanswered substantive threads. Green CI does not replace thread closure.

### 7 — Merge

Only after steps 5–6: `gh pr merge --squash`. Do NOT enable auto-merge before steps 5–6 — `pr-auto-merge.yml` merges on CI alone.

### 8 — Deploy confirmed

Wait for Cloudflare Pages and/or Workers to finish. Push ≠ deployed.

### 9 — Production verify

```sh
npm run verify:prod -- --scope=auto --depth=smoke
```

From repo root. Report exit code. Use `--scope=full --depth=full` for shared/tooling/workflow/verification changes. Loop until exit 0.

---

## Closeout checks (run before claiming task complete on a topic branch)

```sh
npm run ship:closeout:strict && npm run wait-for-bots
```

- `ship:closeout:strict` exit 2 = open PR still exists → continue steps 5–9.
- `wait-for-bots` exit 2 = < 20 min since `ci_result` green → wait and re-sweep bots.

---

## Hard constraints

These user phrases do NOT waive the wait gate (step 5) or thread closure (step 6):

- "Merge everything" / "batch merge" / "just merge"
- "CI green" / "checks passed" / urgency / frustration tone

Only an explicit written waiver for that specific PR waives bot closeout for that PR.

## Forbidden completions while an open PR exists

Never say: "done", "shipped", "PR opened", "CI green so we're good", "handing off the PR", "merge-ready" — until steps 5–9 are satisfied or the user has explicitly waived them.

## Exception

Direct `main` push only if the user explicitly requests a hotfix on `main`. Still do steps 8–9 after deploy.
