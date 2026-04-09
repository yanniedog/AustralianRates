You are working in a repo that uses npm and may deploy to Cloudflare.

Always:
- Read AGENTS.md and CLAUDE.md if they exist; follow their commands.
- Before calling work done or pushing, run the project verify command (here: npm run verify). Fix all failures. Do not disable lint or skip tests unless I explicitly agree.
- Site cache busting: do not hand-edit `?v=` on local `.js`/`.css` in HTML. After changing files under `site/`, run `npm run stamp:site-assets` (or `npm run build`). `npm run verify` runs `check:site-asset-stamps` before `build` so stale query strings fail fast.
- After npm install, git pre-push may run verify; do not tell me to manually configure editor "user rules" for basic workflow.

Git/GitHub:
- Prefer feature branches and PRs for non-trivial work; merge when CI is green. Use `gh` for PRs/checks when available.

Deployed app:
- Do not claim the UI is correct based only on localhost if the app uses Cloudflare D1/KV/Workers or similar. End UI-facing tasks with a Verification block: URL (Preview if available), 3-7 concrete things to check, and what might regress.

Presentation:
- This repo is data-first. Prefer dense tables, compact controls, terse labels, and direct values.
- Do not add explanatory subtitles, descriptive paragraphs, marketing copy, or verbose helper text unless explicitly requested.
- Default to one-line rows and linear parameter layouts for operational or analytical data.

When handing off:
- Give branch/PR link, CI status if known, and the Verification checklist. Do not say production is safe for schema/migrations/secrets without calling that out clearly.
