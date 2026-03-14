# Next Development Step Report

Date: 2026-03-14
Mode: advisory / read-only analysis converted into a saved report
Scope: identify the single highest-leverage next development step for a) frontend and b) backend

---

## Executive conclusion

The next phase should focus on **operational completeness**, not new end-user features.

- **Frontend next step:** make coverage-gap diagnostics directly actionable in the admin UI.
- **Backend next step:** make coverage-gap detection trigger bounded self-healing instead of depending primarily on manual intervention.

This recommendation follows the latest production audit and forensic review, which both indicate that the main unresolved risk is coverage completeness rather than missing admin/export UX basics or missing visibility.

---

## What was reviewed

- `AGENTS.md`
- `docs/MISSION_AND_TECHNICAL_SPEC.md`
- `docs/site-improvement-roadmap.md`
- `docs/site-critique.md`
- `docs/PROJECT_CRITIQUE_AND_CHANGES.md`
- `docs/production-coverage-audit-2026-03-14.md`
- `docs/daily-runs-forensic-analysis-2026-03-14.md`
- `site/README.md`
- `site/admin/status.html`
- `site/admin/status-page.js`
- `site/admin/runs.html`
- `workers/api/src/db/lender-dataset-status.ts`
- `workers/api/src/pipeline/bootstrap-jobs.ts`
- `workers/api/src/pipeline/coverage-gap-audit.ts`
- `workers/api/src/pipeline/replay-queue.ts`
- `workers/api/src/pipeline/scheduled.ts`
- `workers/api/src/pipeline/scheduler-dispatch.ts`
- `workers/api/src/routes/admin-hardening.ts`
- `workers/api/wrangler.toml`

---

## Current state

### What is already in place

- Coverage-gap auditing already exists and is driven from lender/day invariants.
- Replay queue infrastructure already exists.
- Queue idempotency is enabled in worker config.
- Admin status UI already displays coverage gaps and replay queue state.
- Admin runs UI already exposes a targeted lender/day reconciliation action.

### What is still true in production

- The production audit explicitly says not to describe current data as deep historical coverage.
- The same audit identifies recurring lender/day gaps and says zero-row days should be visible in ops dashboards.
- The forensic review says the system is still not watertight for a strict zero-miss guarantee.

The implication is that visibility is no longer the main missing capability. The remaining gap is closing the loop from detection to remediation.

---

## Recommendation A: Frontend

### Next step

Add **direct remediation actions to the admin coverage-gap view** on the status page.

### What to build

- Add per-row actions on the coverage-gap table:
  - `Replay`
  - `Reconcile lender/day`
- Prefill action payloads from the selected row:
  - `lender_code`
  - `dataset_kind`
  - `collection_date`
- Show inline request/result state:
  - queued
  - running
  - success
  - failed
- Refresh coverage-gap and replay-queue panels after action completion.
- Keep the existing runs-page reconcile flow, but stop forcing operators to jump pages for the common case.

### Why this is the next frontend step

- The data already exists in the status page.
- The remediation API already exists.
- The current UX splits diagnosis and action across two admin pages.
- That split increases operator friction exactly where the product most needs reliability and trust.

### Files most likely involved

- `site/admin/status.html`
- `site/admin/status-page.js`
- possibly shared admin styling in `site/admin/admin-pages.css`

### Success criteria

- An operator can move from detected gap to remediation without leaving the status page.
- Post-action state is visible immediately.
- The UI makes it obvious whether a gap has been replayed, reconciled, or is still blocked.

---

## Recommendation B: Backend

### Next step

Add **automatic bounded remediation for stale coverage-gap failures**.

### What to build

- Extend scheduled hardening flow so that when the coverage-gap audit finds stale `error` rows, the system automatically:
  - attempts replay for the exact scope first, or
  - triggers a forced lender/day reconciliation when replay is not sufficient for that scope
- Keep retries bounded by the existing replay settings and collection-date scope.
- Persist enough outcome detail to distinguish:
  - detected
  - replay dispatched
  - reconciliation dispatched
  - recovered
  - still failing after bounded remediation
- Escalate only after the bounded self-healing path fails.

### Why this is the next backend step

- The repo already has the required building blocks:
  - invariant-based completion
  - coverage-gap audit
  - replay queue
  - manual lender/day reconciliation
- Production still has recurring lender/day gaps.
- The forensic review’s remaining concern is not “can we see failures?” but “do failures self-heal deterministically enough?”

### Files most likely involved

- `workers/api/src/pipeline/scheduled.ts`
- `workers/api/src/pipeline/scheduler-dispatch.ts`
- `workers/api/src/pipeline/coverage-gap-audit.ts`
- `workers/api/src/pipeline/replay-queue.ts`
- `workers/api/src/routes/admin-hardening.ts`
- possibly a small new helper under `workers/api/src/pipeline/`

### Success criteria

- A stale coverage gap does not remain manual-only by default.
- The system attempts exact-scope recovery before requiring operator action.
- Logs and admin diagnostics clearly show what automatic remediation was attempted and why it did or did not clear the gap.

---

## Why these steps beat the alternatives

### Not the public frontend first

A public freshness/coverage banner would be useful, but it does not reduce the underlying operational failure rate. It is a secondary step after improving remediation.

### Not admin-export work first

Most of the earlier admin-export gaps are already marked done in the current critique and roadmap documents.

### Not route refactor first

`admin.ts` and `public.ts` still exceed the size guideline, but that is a maintainability task. The production docs point to coverage completeness as the more urgent product risk.

---

## Suggested order

1. Frontend: add coverage-gap actions to the admin status page.
2. Backend: wire scheduled bounded auto-remediation from coverage-gap audit results.
3. After that, add a public-facing coverage/freshness disclosure if desired.
4. Then return to structural refactors such as oversized route files.

This order gives operators a faster manual path immediately, then reduces the need for manual intervention altogether.

---

## Risks and guardrails

- Do not hide failures behind silent retries. The admin UI and logs must still show the original gap and the attempted remediation.
- Keep remediation bounded to exact scope to avoid broad accidental reruns.
- Preserve the project’s real-data-only philosophy in any new tests.
- Do not describe production coverage more strongly than the audit supports until the recurring gap pattern is materially reduced.

---

## Verification note

This report is based on repository inspection and existing audit documents. No code changes, tests, deploys, or production verification commands were run as part of producing this report.
