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

a. Run `npm run wait-for-bots` after creating a new PR — it exits 2 with time remaining if **< 7 minutes since PR creation** (see `scripts/wait-for-bots.mjs`). Do not proceed until exit 0.
b. Also wait **7 minutes after tagging bots** in PR comments or review replies, then re-sweep before merging. Do **not** restart this wait solely because you pushed a code change; fix-ups on the same PR go to CI + synthesis + thread closure unless you tagged bots.
c. `gh pr view <n> --comments`
d. `gh api repos/<owner>/<repo>/pulls/<n>/reviews`
e. `gh api repos/<owner>/<repo>/pulls/<n>/comments`
f. On github.com: scan Conversation + Files until in-flight bot activity settles.
g. Note all bots that commented after your last push: Gemini Code Assist, Codex, Copilot, CodeRabbit, Greptile, Sourcery, security scanners.

**Do not assume “bots are done” from a handful of early comments.** Bots post in waves; the synthesis step handles reading every thread before you reply.

### 5b — Synthesize all feedback before responding (hard; never skip)

After `wait-for-bots` exits 0, and before replying to any thread:

1. Fetch ALL threads (step 5c–f above).
2. **Read every thread before replying to any of them.**
3. Post ONE `## Feedback plan` comment on the PR: list every thread → implement / defer / decline + reason; note dependencies.
4. Only after posting the plan: make code changes (single push), then reply in-thread to each bot/reviewer.

Do NOT claim "no actionable feedback" from a top-level summary without checking all inline file-level threads.

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
- `wait-for-bots` exit 2 = < 7 min since **PR creation** → wait and re-sweep bots; if you tagged bots, observe the manual 7-minute wait before merging.

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
