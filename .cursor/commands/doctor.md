# doctor

Apply the **doctor** skill (`.cursor/skills/doctor/SKILL.md`).

1. From repo root, run **`npm run doctor`** and use the output as the primary production signal (diagnose-api, log stats + actionable with **non-zero exit if actionable lists issues**, full status-debug-bundle written to **`status-debug-bundle-latest.json`** plus a short summary). Treat **`stats.count`** as total stored error rows, not “failures this run.”
2. **Read `./status-debug-bundle-latest.json`** during triage (gitignored; **delete** after analysis). Use deeper **`fetch-production-logs.js`** or admin Status export only when the skill calls for it.
3. Run the **elite-debugger** loop: triage root causes, fix in repo, commit–sync, wait for deploy.
4. Run **`npm run doctor:verify`** and do not mark production work complete until AGENTS.md checks pass (or note explicit waiver).

Respect **ADMIN_API_TOKEN** in `.env` and project rules (real data only in tests, verify on production).

This command is available in chat as **/doctor**.
