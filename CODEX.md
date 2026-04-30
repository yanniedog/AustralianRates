# Codex (OpenAI) — Australian Rates

Read **`AGENTS.md`** and **`CLAUDE.md`** at this repo root for commands, production verification, and presentation rules. **Antidote to early stop:** **`docs/ASSISTANT_SHIP_CLOSEOUT.md`** and **`npm run ship:closeout`** before you claim a shipping task is done.

## Git workflow (default)

Same as **Cursor** / **Claude**: feature branch → PR to **`main`** → **`ci_result`** → **wait gate + in-thread replies** (**`.cursor/rules/git-pr-workflow-default.mdc`**). Never merge on CI alone; **`.cursor/rules/workflow-rules-never-overridden.mdc`** applies. Follow-ups on the **same** PR. **`docs/CONCURRENT_AGENT_WORKFLOW.md`** (automation/settings).

**Exception:** direct **`main`** push only if the user explicitly requests a hotfix on `main`.

**After merge to `main`:** confirm Cloudflare deploys, then run the targeted production checks from **`AGENTS.md`**: default to `npm run verify:prod -- --scope=auto --depth=smoke`, and use `npm run verify:prod -- --scope=full --depth=full` for shared/tooling/workflow changes or explicit full sign-off.
