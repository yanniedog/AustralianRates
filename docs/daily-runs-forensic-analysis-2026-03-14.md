# Daily Runs Forensic Assessment v2 (Capture Completeness, Storage Integrity, Longitudinal Organization)

Date: 2026-03-14  
Analyst mode: adversarial / failure-first  
Scope: `workers/api` scheduler, queue consumers, persistence tables, run reconciliation, and integrity controls.

---

## 1) Executive conclusion (objective)

**Current state is strong but not watertight for a strict “zero-missed product/rate” production guarantee.**

### Why this conclusion is objective

A watertight claim requires all of the following to be true simultaneously:

1. Universe completeness is guaranteed (every in-scope bank/product is always discovered).  
2. Partial failures always self-heal automatically.  
3. Completion logic cannot falsely mark a lender/day as done.  
4. Duplicate/replay/race behavior is bounded and deterministic.  
5. Evidence capture is sufficient for complete forensic reconstruction.

At least **three** of those criteria are not yet fully satisfied in current implementation.

---

## 2) Method used

This reassessment is based on:

- Static code-path analysis across scheduler → job enqueue → queue consumer → detail fetch → DB upsert → run finalization.
- Inspection of hard-failure behavior (retry, max attempts, non-retryable handling).
- Inspection of longitudinal identity and presence lifecycle semantics.
- Verification of configured lender universe size from repository config.

No assumptions were treated as verification; where runtime evidence was unavailable, this is explicitly marked as unknown.

---

## 3) What works well (production strengths)

1. **Clear orchestration boundaries:** scheduled dispatch separates daily ingest from hourly coverage/site-health tasks.  
2. **Per-run and per-lender state model exists:** run reports + lender-dataset run rows + finalization hooks provide operational traceability.  
3. **Dataset split is explicit and complete within configured scope:** home loans, savings, and term deposits all have dedicated handlers and detail processing.  
4. **Lineage enforcement exists at write path:** accepted detail rows missing lineage trigger errors instead of silent acceptance.  
5. **Longitudinal organization is disciplined:** series identity (`series_key`) + product identity (`product_key`) + presence status + latest projections are all maintained.

These are the right primitives for a robust ingestion platform.

---

## 4) Critical findings (gaps that block “watertight” status)

## C1 — Universe completeness is config-bounded, not globally guaranteed

Daily collection iterates configured `TARGET_LENDERS`; therefore completeness is only true **within that list**. If a lender is absent from config, it is never collected.

**Impact:** “all banks / all products” cannot be guaranteed unless lender-universe governance is continuously enforced.

## C2 — Lender/day completion heuristic can false-positive after partial success

Pending lender detection for scheduled daily runs checks whether **any row exists** for lender/date in historical tables. A lender with partial writes can be treated as complete and skipped on subsequent ticks for the same date.

**Impact:** durable holes are possible without explicit replay, even when run appears generally successful.

## C3 — Retry exhaustion does not guarantee deterministic repair

Queue processing retries with backoff; once max attempts is reached, message is acknowledged and run outcome is marked failed. Automatic deterministic replay of failed lender/product units is not guaranteed in that path.

**Impact:** completeness depends on manual intervention or later broad reruns.

---

## 5) High findings (material reliability risk)

## H1 — Queue idempotency is disabled by default in worker vars

`FEATURE_QUEUE_IDEMPOTENCY_ENABLED = "false"` reduces protection against duplicate processing side-effects. Upsert conflict keys mitigate data corruption but do not eliminate duplicate execution/race overhead.

## H2 — Successful probe capture is sampled, not exhaustive

Probe payload capture stores all failures but samples successes (~5%) by default. That is cost-efficient but weakens complete forensic traceability during non-failure windows.

## H3 — UBank no-signal soft-fail behavior can normalize empty outcomes

Soft-fail logic for UBank allows no-signal completion when index fetch is unsuccessful and statuses are non-2xx.

**Impact:** pragmatic operational behavior, but it can mask real upstream regressions if not tightly monitored.

---

## 6) Medium findings (important but not immediate blockers)

1. **Six-hour schedule semantics:** “daily” capture is implemented as interval-based (every 6 hours), which helps resilience but complicates strict end-of-day completeness interpretation.
2. **Large max-products guardrail:** high product cap protects against runaway pagination but still depends on upstream behavior and per-lender quality.
3. **Stale-run reconciliation is corrective, not preventive:** it repairs lifecycle state but does not itself guarantee missing detail jobs are replayed.

---

## 7) Longitudinal data organization quality

### Positive

- Time-series identity dimensions are explicit and dataset-specific.
- Presence lifecycle marks removed products/series over time.
- Latest projections and catalogs are updated on write.
- Run reconciliation closes stale lifecycle state and finalizes ready rows.

### Remaining longitudinal risk

If a lender/day is falsely considered complete after partial writes, longitudinal continuity may silently miss daily observations for some series while lender/date appears represented.

---

## 8) Objective reliability scorecard (0–5)

- Scheduler/orchestration robustness: **4.0 / 5**  
- Queue execution resilience: **3.2 / 5**  
- Completeness guarantees (strict zero-miss): **2.3 / 5**  
- Forensic traceability: **3.4 / 5**  
- Longitudinal organization correctness: **4.2 / 5**

**Overall for your stated requirement (“miss nothing, process/store correctly”): 2.9 / 5 (not sufficient).**

---

## 9) Hardening actions required for a zero-miss posture

## Priority 0 (must-do)

1. Replace lender/day “any row exists” completion with invariant-based completion from `lender_dataset_runs` (`index_fetch_succeeded`, expected detail count reached, lineage clean, finalized).
2. Add deterministic replay queue for exhausted failures (lender+dataset+date+product granularity) with bounded retries + incident alerts.
3. Enable queue idempotency in production and track duplicate-claim metrics.

## Priority 1

4. Add lender/day coverage SLO checks: discovered products vs detail processed vs written series, with automatic alert thresholds.
5. Add strict “coverage gap” reporting endpoint and dashboard panel fed directly from run/lender invariants.
6. Run scheduled lender-universe audit against policy scope (e.g., CDR register comparison) and open automatic drift tickets.

## Priority 2

7. Add temporary full-capture mode for successful probes during incident windows.
8. Add replay-safe “forced lender/day reconciliation run” admin operation.

---

## 10) What you can rely on today vs not rely on

### You can rely on

- Good overall ingest architecture and observability.
- Strong data modeling for longitudinal analysis.
- Meaningful safeguards against silent bad writes (validation + lineage checks).

### You should **not** rely on yet

- Absolute guarantee that no product/rate will ever be missed under upstream instability or partial-run failure modes.
- Fully automatic self-healing after exhausted queue failures.
- Global “all banks” completeness unless lender-universe governance is automated and enforced.

---

## 11) Explicit unknowns (not verified in this pass)

- Live production run outcomes for recent days could not be independently benchmarked from this environment.
- External registry/web checks were attempted but blocked by environment egress restrictions.

These unknowns do **not** change the structural findings above; they only limit live corroboration.

---

## 12) Final answer to your requirement

If your requirement is:

> “I do not want any bank products or bank rates to be missed or processed/stored incorrectly.”

then the **current setup should be treated as high-quality but not yet watertight**. Implement Priority 0 hardening before asserting production-grade zero-miss guarantees.
