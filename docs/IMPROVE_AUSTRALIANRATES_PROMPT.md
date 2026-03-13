# Prompt: Improve AustralianRates

Use this prompt as-is (or with minor edits) when asking another LLM to improve the AustralianRates project.

---

## Instructions for the LLM

You are improving the **AustralianRates** project: a monorepo with a static frontend (Cloudflare Pages at www.australianrates.com), an API worker (Hono, D1, R2, Queue, Durable Object), and an archive worker. The project collects, normalizes, stores, and publishes comparable Australian rate data for home loans, savings, and term deposits.

**Mandatory rules you must follow:**

1. **Project rules**  
   Read and obey `AGENTS.md` and the always-applied rules in `.cursor/rules` (e.g. `fix-commit-verify-loop.mdc`, `deployment.mdc`, `no-mock-test-data.mdc`). Before claiming any deploy-related work is done, run from repo root: `npm run test:homepage`, `npm run test:api`, `npm run test:archive`. If any exit non-zero, fix and re-run until all pass. Never present an assumption as verification.

2. **Real data only in tests**  
   Do not use mocks, stubs, or hand-crafted business data in tests. Use real D1 (e.g. vitest-pool-workers with migrations), real API responses, or real-data fixtures. See `docs/MISSION_AND_TECHNICAL_SPEC.md` (Project Philosophy: Real Data Only) and `.cursor/rules/no-mock-test-data.mdc`.

3. **Mission and invariants**  
   Align all changes with `docs/MISSION_AND_TECHNICAL_SPEC.md`: `product_key` longitudinal identity, `collection_date` and `run_source` semantics, public API derived from D1, no financial advice. Do not violate core invariants.

4. **Code quality**  
   Max file size 300 lines (flag) / 500+ (refactor); max function 50 lines; DRY; single responsibility. Do not refactor build/config, migrations, `package.json`, or single-purpose entry points listed in AGENTS.md.

**Improvement backlog (prioritized):**

Use the following two critique documents as the authoritative backlog. Implement or document in order of priority; skip items already done in the repo.

- **`docs/site-critique.md`**  
  Full site critique (front end, UX, backend, Cloudflare, cost, security, maintainability, accessibility, etc.). Summary table at the end lists P0/P1/P2 actions with file references.

- **`docs/admin-export-critique.md`**  
  Admin export center (UX, API, reconstruction). Covers delta cursor discoverability, retry for failed jobs, artifact metadata in UI, error shape, validation, reconstruction docs, and D1/R2 import tooling.

**Already implemented (do not redo):**  
Admin export **retry** for failed jobs (API: `POST /admin/downloads/:jobId/retry`, UI: Retry button in exports). Admin export API and reconstruction are documented in `docs/admin-export-api.md` and `docs/admin-export-reconstruction.md`.

**Suggested next improvements (from critiques):**

- **P1** – Delta cursor UX: add a short hint for “Delta since cursor” (what it is, where to get it), and optionally a “Use latest” control that pre-fills from the section’s latest completed job `end_cursor`. Optionally persist or pre-fill the cursor when loading the section.
- **P1** – Show artifact metadata in the admin export UI: row count, size (humanized), and cursor range per artifact (or summary) in job cards. API already returns these fields.
- **P2** – D1 import script: script that reads admin export JSONL (e.g. operational or canonical) and applies upserts to D1; document in `docs/admin-export-reconstruction.md`. Optional: R2 restore script for canonical payload JSONL.
- **P2** – Document script load order and `AR.*` dependencies for the site; document Cloudflare limits pointer; document archive worker purpose and envs; document admin auth (Bearer vs CF Access).
- **P2** – Accessibility: document current coverage (skip link, ARIA), gaps (keyboard, screen-reader), and loading/error states for main flows.
- **P2** – Maintainability: monitor route file sizes (`public.ts`, `admin.ts`); add an “Adding a new section” checklist; document primary breakpoint and mobile-host behavior.

**Deliverables:**

- Implement one or more of the above (or other items from the critique summary tables) in code and/or docs.
- Run `npm run typecheck:api` when touching API code.
- If you change anything that affects production (frontend, API, or archive), run the fix–commit–verify loop: commit, push to `main`, wait for deploy, then run `npm run test:homepage`, `npm run test:api`, `npm run test:archive` and fix until all pass. Include in your response the exact commands run, exit codes, and pass/fail summary.

**References:**  
`AGENTS.md`, `docs/MISSION_AND_TECHNICAL_SPEC.md`, `docs/USER_INTERACTION_FLOWCHART.md`, `docs/CLOUDFLARE_USAGE.md`, `.cursor/rules/`.

---

*This prompt was generated from the orchestration workflow and the project’s critique documents. Update the “Already implemented” section as the backlog is completed.*
