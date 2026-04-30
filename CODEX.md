# Codex (OpenAI) — Australian Rates

Read **`AGENTS.md`** and **`CLAUDE.md`** at this repo root for commands, production verification, and presentation rules.

## Git workflow (default)

Match **Cursor** and **Claude** instructions: **feature branch** off `main`, **push the branch**, open a **PR to `main`**, green **GitHub Actions / `ci_result`** on that PR, then the **Bot feedback wait gate** (**late sweep + ~10–15 minute** re-check for late bots unless waived), **in-thread replies on every PR review bot** thread, **then merge**. Never merge only because CI finished. Details: **`docs/CONCURRENT_AGENT_WORKFLOW.md`** (**CI vs PR review bots**) and **`.cursor/rules/git-pr-workflow-default.mdc`** (**Bot feedback wait gate**, “PR review bots”).

**Exception:** direct **`main`** push only if the user explicitly requests a hotfix on `main`.

**After merge to `main`:** confirm Cloudflare deploys, then run the targeted production checks from **`AGENTS.md`**: default to `npm run verify:prod -- --scope=auto --depth=smoke`, and use `npm run verify:prod -- --scope=full --depth=full` for shared/tooling/workflow changes or explicit full sign-off.
