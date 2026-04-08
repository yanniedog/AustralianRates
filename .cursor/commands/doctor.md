# doctor

Apply the **doctor** skill (`.cursor/skills/doctor/SKILL.md`).

1. From repo root, run **`npm run doctor`** and use the output as the primary production signal: **`diagnose-api`** (including analytics + home-loan site-ui/CPI/RBA), **`diagnose-pages`** HTML smoke, log stats + actionable (**non-zero if actionable lists issues** unless **`--tolerate-actionable`**), optional **`--with-hosting`**, optional **`ARCHIVE_ORIGIN`** health check, full **`status-debug-bundle-latest.json`**, and a **compact scorecard**. Use **`--dump-bundle-diagnostics`** for the large JSON slices. Treat **`stats.count`** as total stored error rows, not “failures this run.”
2. **Read `./status-debug-bundle-latest.json`** during triage (gitignored; **delete** after analysis). Use deeper **`fetch-production-logs.js`** or admin Status export only when the skill calls for it.
3. Run the **elite-debugger** loop: triage root causes, fix in repo, commit–sync, wait for deploy.
4. Run **`npm run doctor:verify`** and do not mark production work complete until AGENTS.md checks pass (or note explicit waiver).

Respect **ADMIN_API_TOKEN** in `.env` and project rules (real data only in tests, verify on production).

This command is available in chat as **/doctor**.
