You are working in a repo that uses npm and may deploy to Cloudflare.

Always:
- Read AGENTS.md and CLAUDE.md if they exist; follow their commands.
- **Every chat with repo changes:** commit and push; confirm Cloudflare deploy and CI succeeded (fix failures until green); confirm the intended outcome on https://www.australianrates.com per AGENTS.md—waived only if the user says so explicitly. See `.cursor/rules/every-chat-commit-deploy-verify-production.mdc`.
- Before calling work done or pushing, run the project verify command (here: npm run verify). Fix all failures. Do not disable lint or skip tests unless I explicitly agree.
- Site cache busting: do not hand-edit `?v=` on local `.js`/`.css` in HTML. After changing files under `site/`, run `npm run stamp:site-assets` (or `npm run build`). `npm run verify` runs `check:site-asset-stamps` before `build` so stale query strings fail fast.
- After npm install, git pre-push may run verify; do not tell me to manually configure editor "user rules" for basic workflow.

Git/GitHub:

- **Default** (unless user waives or orders a **`main` hotfix**): `git checkout -b agent/<slug>` from fresh `origin/main` → commit → `gh pr create --base main` → `gh pr checks <n> --watch` until `ci_result` green → **wait gate** (stop; sweep PR comments/reviews via `gh` + github.com; if no threads wait ~10–15 min then re-sweep; calling “no feedback” at green CI is a violation) → **reply in-thread** on every substantive bot/human thread (implemented/deferred/declined) → `gh pr merge --squash` → confirm Pages/Workers deployed → `npm run verify:prod -- --scope=auto --depth=smoke` (exit 0). Urgency / “merge all” / “just merge” / frustration **never** waive the wait gate or thread closure — only an explicit written waiver for that PR does. Same PR for follow-ups. Ops detail: **`docs/CONCURRENT_AGENT_WORKFLOW.md`**; full step reference: **`.cursor/rules/git-pr-workflow-default.mdc`**.
- **Codex:** also read repo-root `CODEX.md` (full inline ship bar there).

Deployed app:
- Do not claim the UI is correct based only on localhost if the app uses Cloudflare D1/KV/Workers or similar. End UI-facing tasks with a Verification block: URL (Preview if available), 3-7 concrete things to check, and what might regress.

Presentation:
- This repo is data-first. Prefer dense tables, compact controls, terse labels, and direct values.
- Do not add explanatory subtitles, descriptive paragraphs, marketing copy, or verbose helper text unless explicitly requested.
- Default to one-line rows and linear parameter layouts for operational or analytical data.

When handing off:
- **Shipping tasks:** handing off is **after** merge to `main`, deploy, and **`npm run verify:prod -- --scope=auto --depth=smoke`** (evidence in the message)—not “here is the PR” while you still have merge ability. While still on a topic branch, run **`npm run ship:closeout:strict`** before your final message; **exit 2** means finish **AGENTS.md** steps 5–9 (or state a blocker). If you are **blocked** (no auth, no merge rights), give the PR URL, CI status, **and** the exact remaining steps from **`docs/ASSISTANT_SHIP_CLOSEOUT.md`**. Do not say production is safe for schema/migrations/secrets without calling that out clearly.
