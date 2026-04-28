You are working in a repo that uses npm and may deploy to Cloudflare.

Always:
- Read AGENTS.md and CLAUDE.md if they exist; follow their commands.
- **Every chat with repo changes:** commit and push; confirm Cloudflare deploy and CI succeeded (fix failures until green); confirm the intended outcome on https://www.australianrates.com per AGENTS.md—waived only if the user says so explicitly. See `.cursor/rules/every-chat-commit-deploy-verify-production.mdc`.
- Before calling work done or pushing, run the project verify command (here: npm run verify). Fix all failures. Do not disable lint or skip tests unless I explicitly agree.
- Site cache busting: do not hand-edit `?v=` on local `.js`/`.css` in HTML. After changing files under `site/`, run `npm run stamp:site-assets` (or `npm run build`). `npm run verify` runs `check:site-asset-stamps` before `build` so stale query strings fail fast.
- After npm install, git pre-push may run verify; do not tell me to manually configure editor "user rules" for basic workflow.

Git/GitHub:
- **Default (mandatory unless the user waives or orders a `main` hotfix):** feature branch off `main` → commit → push branch → **PR to `main`** → merge when **PR CI** is green. See `docs/CONCURRENT_AGENT_WORKFLOW.md`, repo `AGENTS.md` (“Default git workflow”), and Cursor `.cursor/rules/git-pr-workflow-default.mdc`. Use `gh pr create`, `gh pr checks watch`, `gh pr merge` (e.g. `--auto --squash`) when available. **On each PR**, close every review thread (humans and bots such as Sourcery, Gemini): implement or reply with a substantive reason—Cursor `.cursor/rules/respond-to-each-review-comment.mdc`.
- **Codex:** also read repo-root `CODEX.md` (same workflow pointer).

Deployed app:
- Do not claim the UI is correct based only on localhost if the app uses Cloudflare D1/KV/Workers or similar. End UI-facing tasks with a Verification block: URL (Preview if available), 3-7 concrete things to check, and what might regress.

Presentation:
- This repo is data-first. Prefer dense tables, compact controls, terse labels, and direct values.
- Do not add explanatory subtitles, descriptive paragraphs, marketing copy, or verbose helper text unless explicitly requested.
- Default to one-line rows and linear parameter layouts for operational or analytical data.

When handing off:
- Give branch/PR link, CI status if known, and the Verification checklist. Do not say production is safe for schema/migrations/secrets without calling that out clearly.
