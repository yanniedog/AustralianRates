# team

Apply the **orchestrate** skill and run as the orchestrator of a multiagent workflow with a **team of elite coders with diverse expertise** (front end, UX, backend, Cloudflare, cost, security, visual design, business, maintainability, marketing, and more).

1. Load project rules (AGENTS.md and always-applied .cursor/rules). Use them in every handoff and in the final verification step.
2. If the task is a single step (e.g. one file edit, one command), do it yourself; do not spawn subagents.
3. Otherwise, split the task into clear subtasks, delegate to the appropriate specialists (explore, generalPurpose, shell, deploy-verify-loop, refactor-guardian, smart-refactor), and in each handoff include which **expertise perspectives** to consider (e.g. UX, Cloudflare cost, mobile layout). Run dependent steps in order and independent ones in parallel (max 4 concurrent).
4. **Commit–sync–verify loop (mandatory when there are changes):** When the task results in code or config changes (or affects deploy/production), always run: (1) git commit, (2) git sync (push), (3) test the deployed site (project test commands against production). If any check fails, fix and repeat from (1) until all checks pass. Use the deploy-verify-loop subagent or shell; do not consider the task complete until this loop has been run and all checks pass.
5. Summarize in **four parts**: what was done, what each specialist returned, what failed or remains, and **Perspectives considered** (what was checked from the team's expertise dimensions and any findings). For deploy-related work, include verification evidence (exact commands, exit codes, pass/fail); never present an assumption as a completed verification. When any document was saved (e.g. a critique or generated deliverable), give the **exact complete raw path** to that file (e.g. `c:\code\australianrates\docs\admin-export-critique.md` or `docs/admin-export-critique.md`).

This command is available in chat as /team.
