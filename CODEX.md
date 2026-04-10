# Codex (OpenAI) — Australian Rates

Read **`AGENTS.md`** and **`CLAUDE.md`** at this repo root for commands, production verification, and presentation rules.

## Git workflow (default)

Match **Cursor** and **Claude** instructions: **feature branch** off `main`, **push the branch**, open a **PR to `main`**, keep **GitHub Actions** green on that PR, **merge** when ready. Details: **`docs/CONCURRENT_AGENT_WORKFLOW.md`** and **`.cursor/rules/git-pr-workflow-default.mdc`**.

**Exception:** direct **`main`** push only if the user explicitly requests a hotfix on `main`.

**After merge to `main`:** confirm Cloudflare deploys, then run production checks from **`AGENTS.md`** (e.g. `npm run test:homepage`, worker tests, `npm run verify` as appropriate).
