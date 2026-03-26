---
name: status-download
description: >-
  Downloads the production admin status-debug-bundle JSON using ADMIN_API_TOKEN from repo root .env.
  Use when the user invokes /status-download, asks for the status debug bundle, E2E triage JSON export,
  or copies a curl example that used a placeholder token. Prefers npm script over raw curl (especially on Windows PowerShell).
---

# Status debug bundle download

Fetches **`GET /api/home-loan-rates/admin/diagnostics/status-debug-bundle`** against production with the **real** Bearer token from **repo root `.env`**. Never use a placeholder like `YOUR_ADMIN_TOKEN` in a real command.

## Canonical command (agent runs from repo root)

```bash
npm run fetch-status-debug-bundle
```

Implementation: `tools/node-scripts/src/fetch-status-debug-bundle.ts` via `fetch-status-debug-bundle.js`. The runner merges **`.env`** into the process environment, so **`ADMIN_API_TOKEN`** (or first entry in **`ADMIN_API_TOKENS`**, or **`ADMIN_TEST_TOKEN`** / **`LOCAL_ADMIN_API_TOKEN`** as fallbacks) is applied automatically.

- **Write to file:** `npm run fetch-status-debug-bundle -- --out=bundle.json`
- **Narrow sections:** `npm run fetch-status-debug-bundle -- --sections=meta,remediation`
- **Other flags:** `--include-probe-payloads`, `--since=ISO`, `--log-limit=N` (see script header in `fetch-status-debug-bundle.ts`)

Default origin: **`https://www.australianrates.com`** (override with **`API_BASE`** if needed).

## Hygiene

Per **AGENTS.md** / **debug-use-logfiles**: treat downloaded bundles as **ephemeral** — **delete** `bundle.json` (or similar) after analysis; do not commit them.

## Why not raw `curl` (especially on Windows)

On **PowerShell**, `curl` is an alias for **`Invoke-WebRequest`**, which does not accept `-H` like curl; that causes header binding errors. Prefer **`npm run fetch-status-debug-bundle`**.

If a manual HTTP client is required:

- Use **`curl.exe`** (real curl) **and** ensure the Bearer value is the token from **`.env`**, not typed into chat. Safer workflow: still use the npm script so the token is never echoed or pasted.

## Token missing

If the script exits with missing token: ensure **`.env`** at repo root contains **`ADMIN_API_TOKEN`** (see **`.env.example`**). Same value as the production API worker secret.

This command is available in chat as **/status-download**.
