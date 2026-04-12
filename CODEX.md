# Codex (OpenAI) — Australian Rates

Read **`AGENTS.md`** and **`CLAUDE.md`** at this repo root for commands, production verification, and presentation rules.

## Git workflow (default)

Match **Cursor** and **Claude** instructions: **feature branch** off `main`, **push the branch**, open a **PR to `main`**, keep **GitHub Actions** green on that PR, **merge** when ready. Details: **`docs/CONCURRENT_AGENT_WORKFLOW.md`** and **`.cursor/rules/git-pr-workflow-default.mdc`**.

**Exception:** direct **`main`** push only if the user explicitly requests a hotfix on `main`.

**After merge to `main`:** confirm Cloudflare deploys, then run the targeted production checks from **`AGENTS.md`**: default to `npm run verify:prod -- --scope=auto --depth=smoke`, and use `npm run verify:prod -- --scope=full --depth=full` for shared/tooling/workflow changes or explicit full sign-off.
