---
name: cloudflare-cost-optimization
description: >-
  Steers Cloudflare projects toward minimal out-of-pocket spend: D1 reads/writes/storage,
  Workers invocations, KV/R2/Pages, and billing tiers. Emphasises constraining and
  rationalising D1 in production and in dev/agent workflows (prefer local D1, avoid
  needless remote D1 or high-churn test patterns, map work to free/included allowances).
  Use when the user mentions Cloudflare costs, D1 quotas, billing, overage, free tier,
  budget, or when designing tests, crons, caches, or migrations that touch D1 or Workers.
---

# Cloudflare cost optimisation (D1-first)

## Stance

Treat **included allowances and free-tier headroom** as a budget. Prefer **caching, batching, fewer round-trips, and local/minimal remote usage** before adding features that scale linearly with reads/writes. **Writes are usually the expensive dimension** for D1 overage; reads also count at scale.

When advising **Cursor / Codex / Claude / CI** flows: every loop of `wrangler d1 ... --remote`, repeated full API integration against production, or migrations run against remote can burn quota or money. **Steer toward local D1 for dev/test**, **targeted** production checks (e.g. project `verify:prod` smoke, not unbounded polling), and **one-shot** remote operations with clear intent.

---

## D1: constrain and rationalise

**Production / app design**

- **Classify traffic** by cost impact: hot paths should hit **KV or precomputed rows** (this repo: `chart_pivot_cache`, snapshot cache, `CHART_CACHE_KV`) before scanning large tables.
- **Batch writes**; avoid per-request write amplification. Prefer idempotent upserts and bounded background work (queues/cron) over synchronous write storms.
- **Narrow SQL**: fewer columns, tighter `WHERE`, sane `LIMIT`, indexes aligned to real query shapes. Full-table habits are a cost risk.
- Respect **operational guardrails** in code: this API worker uses **`d1-budget` / workload classes** and flags like **`PUBLIC_LIVE_D1_FALLBACK_DISABLED`** to protect spend when live D1 fallback would spike reads; do not bypass these without an explicit product reason.
- **Pricing math** (track over time; confirm in Cloudflare dashboard): see `workers/api/src/utils/d1-budget.ts` for published **included monthly reads/writes** and **overage constants** used in-repo. Update that module if Cloudflare changes published numbers.

**Development and testing**

- **`wrangler dev` + `--local` D1**: local SQLite-backed D1 avoids remote quota for day-to-day iteration. Apply **local migrations** when the project requires it (`npx wrangler d1 migrations apply ... --local` from the worker directory) so engineers are not tempted to hit remote for “quick” schema checks.
- **Remote D1** (`--remote`, dashboard export, backups): use for **intentional** ops (sign-off, debugging prod data shape), not in tight agent loops.
- **Tests**: follow project **real-data-only** rules (no mocking business data). Still **minimise churn**: prefer **pure unit tests** for literals/parsing, **local** vitest-pool-workers against local D1 where integration is required, and avoid test suites that repeatedly re-seed huge remote datasets.
- **Agents should not** propose: running remote D1 imports/exports in a loop, “verify” scripts that hammer production database-backed endpoints without rate awareness, or new cron frequency without D1 cost consideration.

---

## Other Cloudflare surfaces (short)

- **Workers**: cold starts and **request volume** matter; reduce unnecessary subrequests and fan-out. Use **caching headers** on public responses where correct.
- **KV / R2**: often cheaper than repeated D1 reads for static or blobby assets; still count operations and egress in planning.
- **Pages**: build minutes and seat/billing plan features; keep builds lean; avoid needless full rebuild triggers.

---

## Tier and allowance mapping

- **Know the account plan** (Free vs Paid Workers, D1 GA limits, etc.). **Do not hardcode** limits in skills as law; **pointer**: Cloudflare dashboard **Account / Billing / Workers & Pages** and **D1** product docs for current included monthly reads/writes and storage.
- Steer new work toward **using existing included capacity** before new paid features: e.g. consolidate queries, reuse cache rows, defer nonessential workloads.

---

## Checklist when adding or changing D1 usage

1. **Can this read be replaced or shortened** by cache/KV/snapshot/chart pivot row?
2. **Can these writes be merged** (batch, cron) instead of per user action?
3. **Will tests use local D1** by default?
4. **Will background jobs or crons** multiply reads/writes—are frequency and payload bounded?
5. **Does this path need** the repo’s D1 budget / fallback behaviour reviewed (not disabled casually)?

---

## Australian Rates alignment

- Production verification is **production-host only** per project rules; balance **necessary** smoke checks against **avoiding** repeated expensive anonymous API patterns. Prefer documented commands (`verify:prod`, `diagnose-api` smoke) over ad-hoc brute force.
- **`AGENTS.md`** and **no-mock-test-data** constrain tests: cost optimisation must **not** “fix” quota by introducing fake D1; instead use **local real D1**, **fixtures from real captures**, and **smaller** integration surfaces.

When tradeoffs are unclear, **prefer designs that reduce D1 read/write multiplicity** and document the expected **workload class** (critical vs deferable) consistent with `d1-budget` patterns.
