/**
 * CDR Register discovery: fetch with retry, fallback endpoint, failure capture.
 * Never throws; returns outcome for run_reports and queue retry decisions.
 */

import { resolveLenderKey } from "./config/lenders";
import {
  CDR_REGISTER_FALLBACK,
  CDR_REGISTER_PRIMARY,
  deriveProductsUrl,
  fetchWithRetry,
  normalizeBaseUrl,
} from "./discovery-fetch";

const LOCK_TTL_HOURS = 6;
const FAILURE_PAYLOAD_MAX_CHARS = 50000;
const D1_ROW_LIMIT_BYTES = 2_000_000;

export interface DiscoveryResult {
  ok: boolean;
  runId: string;
  error?: string;
  perLenderCounts?: Record<string, number>;
  warnings?: string[];
  status?: string;
  sourceUrl?: string;
}

interface EndpointDetail {
  publicBaseUri?: string;
  resourceBaseUri?: string;
  version?: string;
}

interface LegalEntity {
  legalEntityName?: string;
}

interface RegisterBrand {
  dataHolderBrandId?: string;
  brandName?: string;
  legalEntity?: LegalEntity;
  endpointDetail?: EndpointDetail;
  status?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function bytesToStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      const payload = new Uint8Array(bytes.byteLength);
      payload.set(bytes);
      controller.enqueue(payload);
      controller.close();
    },
  });
}

async function streamToBytes(stream: ReadableStream<BufferSource>): Promise<Uint8Array> {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function gzipCompressText(text: string): Promise<Uint8Array> {
  const input = new TextEncoder().encode(text);
  const compressed = bytesToStream(input).pipeThrough(new CompressionStream("gzip"));
  return streamToBytes(compressed);
}

async function sha256HexFromText(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function storeRawPayloadBlob(
  db: D1Database,
  payloadJson: string
): Promise<string> {
  const payloadHash = await sha256HexFromText(payloadJson);
  const uncompressedBytes = new TextEncoder().encode(payloadJson).byteLength;
  const compressedPayload = await gzipCompressText(payloadJson);
  const compressedBytes = compressedPayload.byteLength;
  if (compressedBytes > D1_ROW_LIMIT_BYTES) {
    throw new Error(
      `compressed_payload_exceeds_row_limit hash=${payloadHash} bytes=${compressedBytes} limit=${D1_ROW_LIMIT_BYTES}`
    );
  }

  await db
    .prepare(
      "INSERT OR IGNORE INTO raw_payload_store (payload_hash, encoding, payload_blob, uncompressed_bytes, compressed_bytes) VALUES (?, 'gzip', ?, ?, ?)"
    )
    .bind(payloadHash, compressedPayload, uncompressedBytes, compressedBytes)
    .run();

  return payloadHash;
}

/** Compute run date in Australia/Hobart (YYYY-MM-DD). */
export function runDateHobart(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Hobart",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** Acquire run lock; returns runId if acquired, null if already locked. */
export async function acquireRunLock(
  db: D1Database,
  lockKey: string,
  ttlHours: number = LOCK_TTL_HOURS
): Promise<{ acquired: boolean; runId?: string }> {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const runId = `run-${lockKey}-${now.getTime()}`;
  const nowStr = now.toISOString();
  const expiresStr = expires.toISOString();

  try {
    const existing = await db
      .prepare("SELECT lock_key, expires_at FROM run_locks WHERE lock_key = ?")
      .bind(lockKey)
      .first<{ lock_key: string; expires_at: string }>();

    if (existing) {
      const exp = existing.expires_at;
      if (exp && new Date(exp) > now) {
        return { acquired: false };
      }
    }

    await db
      .prepare(
        "INSERT OR REPLACE INTO run_locks (lock_key, run_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .bind(lockKey, runId, nowStr, expiresStr)
      .run();

    return { acquired: true, runId };
  } catch (e) {
    console.error("acquireRunLock", e);
    return { acquired: false };
  }
}

/** Persist raw register payload (success). */
async function saveRawPayload(
  db: D1Database,
  payloadJson: string,
  fetchedAt: string,
  sourceUrl: string
): Promise<string> {
  const id = `cdr_register_${fetchedAt.replace(/[:.]/g, "-")}`;
  const payloadHash = await storeRawPayloadBlob(db, payloadJson);

  try {
    await db
      .prepare(
        "INSERT INTO raw_payloads (id, source_type, fetched_at, source_url, content_hash, payload_hash) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(id, "cdr_register", fetchedAt, sourceUrl, payloadHash, payloadHash)
      .run();
  } catch (e) {
    console.error("saveRawPayload", e);
  }
  return payloadHash;
}

/** Persist failure response for debugging. */
async function saveFailurePayload(
  db: D1Database,
  runId: string,
  sourceUrl: string,
  httpStatus: number,
  bodyText: string,
  errorMessage: string,
  fetchedAt: string
): Promise<void> {
  const id = `cdr_register_failure_${runId}_${Date.now()}`;
  const truncated =
    bodyText.length > FAILURE_PAYLOAD_MAX_CHARS
      ? bodyText.slice(0, FAILURE_PAYLOAD_MAX_CHARS) + "\n...[truncated]"
      : bodyText;
  try {
    const payloadHash = await storeRawPayloadBlob(db, truncated);
    await db
      .prepare(
        "INSERT INTO raw_payloads (id, source_type, fetched_at, source_url, content_hash, payload_hash, http_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        "cdr_register_failure",
        fetchedAt,
        sourceUrl,
        payloadHash,
        payloadHash,
        httpStatus,
        errorMessage.slice(0, 500)
      )
      .run();
  } catch (e) {
    console.error("saveFailurePayload", e);
  }
}

/** Upsert one brand into lender_endpoints_cache. */
async function upsertEndpoint(
  db: D1Database,
  row: {
    lender_key: string;
    brand_id: string;
    brand_name: string;
    api_base_url: string;
    products_url: string;
    product_reference_data_api: string;
    last_seen_at: string;
    raw_json: string;
  }
): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO lender_endpoints_cache (
          lender_key, brand_id, brand_name, api_base_url, products_url,
          product_reference_data_api, discovered_at, expires_at, last_seen_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lender_key, brand_id) DO UPDATE SET
          brand_name = excluded.brand_name,
          api_base_url = excluded.api_base_url,
          products_url = excluded.products_url,
          product_reference_data_api = excluded.product_reference_data_api,
          last_seen_at = excluded.last_seen_at,
          raw_json = excluded.raw_json`
      )
      .bind(
        row.lender_key,
        row.brand_id,
        row.brand_name,
        row.api_base_url,
        row.products_url,
        row.product_reference_data_api,
        row.last_seen_at,
        expiresAt,
        row.last_seen_at,
        row.raw_json
      )
      .run();
  } catch (e) {
    console.error("upsertEndpoint", e);
    throw e;
  }
}

/** Fetch CDR register (primary then fallback with retries), parse, cache, and report. */
export async function discoverCdrRegister(
  db: D1Database,
  runId: string
): Promise<DiscoveryResult> {
  const startedAt = nowIso();
  const warnings: string[] = [];
  const perLenderCounts: Record<string, number> = {};
  const urlsToTry = [CDR_REGISTER_PRIMARY, CDR_REGISTER_FALLBACK];

  let lastResp: Response | null = null;
  let lastBody: string | null = null;
  let lastUrl: string | null = null;
  let lastFailure: { url: string; status: number; body: string } | null = null;

  for (const url of urlsToTry) {
    const result = await fetchWithRetry(url);
    if (result) {
      if (result.resp.ok) {
        lastResp = result.resp;
        lastBody = result.body;
        lastUrl = result.url;
        break;
      }
      lastFailure = {
        url: result.url,
        status: result.resp.status,
        body: result.body,
      };
    }
  }

  if (!lastResp || lastBody === null || !lastUrl) {
    if (lastFailure) {
      await saveFailurePayload(
        db,
        runId,
        lastFailure.url,
        lastFailure.status,
        lastFailure.body,
        `HTTP ${lastFailure.status} (primary and fallback tried)`,
        startedAt
      );
      await updateRunReport(db, runId, "failed_payload_captured", startedAt, null, [
        `Fetch failed: ${lastFailure.status} from last attempted URL`,
      ]);
      return {
        ok: false,
        runId,
        error: `HTTP ${lastFailure.status}`,
        status: "failed_payload_captured",
        sourceUrl: lastFailure.url,
      };
    }
    const errMsg = "All fetch attempts failed (primary and fallback)";
    await updateRunReport(db, runId, "failed", startedAt, null, [errMsg]);
    return { ok: false, runId, error: errMsg, status: "failed" };
  }

  try {
    let data: unknown;
    try {
      data = JSON.parse(lastBody);
    } catch (e) {
      console.error("discoverCdrRegister parse", e);
      await saveFailurePayload(
        db,
        runId,
        lastUrl,
        lastResp.status,
        lastBody,
        "Invalid JSON from CDR register",
        startedAt
      );
      await updateRunReport(db, runId, "failed_payload_captured", startedAt, null, [
        "Invalid JSON from CDR register",
      ]);
      return {
        ok: false,
        runId,
        error: "JSON parse error",
        status: "failed_payload_captured",
        sourceUrl: lastUrl,
      };
    }

    await saveRawPayload(db, lastBody, startedAt, lastUrl);

    const brands = extractBrands(data);
    if (brands.length === 0) {
      warnings.push("No data holder brands found in register response");
    }

    const lastSeen = nowIso();
    let upsertErrors = 0;
    for (const b of brands) {
      const publicUri = b.endpointDetail?.publicBaseUri ?? b.endpointDetail?.resourceBaseUri ?? "";
      if (!publicUri) {
        warnings.push(`No endpoint for brand ${b.dataHolderBrandId ?? b.brandName ?? "?"}`);
        continue;
      }

      const apiBaseUrl = normalizeBaseUrl(publicUri);
      const productsUrl = deriveProductsUrl(apiBaseUrl);
      const brandName = (b.brandName ?? "").trim() || "Unknown";
      const legalName = b.legalEntity?.legalEntityName ?? "";
      const lenderKey = resolveLenderKey(brandName, legalName);
      const brandId = (b.dataHolderBrandId ?? `${lenderKey}-${brandName}`).trim() || "unknown";

      perLenderCounts[lenderKey] = (perLenderCounts[lenderKey] ?? 0) + 1;

      try {
        await upsertEndpoint(db, {
          lender_key: lenderKey,
          brand_id: brandId,
          brand_name: brandName,
          api_base_url: apiBaseUrl,
          products_url: productsUrl,
          product_reference_data_api: apiBaseUrl,
          last_seen_at: lastSeen,
          raw_json: JSON.stringify({
            dataHolderBrandId: b.dataHolderBrandId,
            brandName: b.brandName,
            legalEntityName: legalName,
            status: b.status,
          }),
        });
      } catch (e) {
        console.error("upsertEndpoint", brandId, e);
        warnings.push(`Failed to upsert ${brandId}: ${(e as Error)?.message}`);
        upsertErrors++;
      }
    }

    const status =
      upsertErrors > 0 && Object.keys(perLenderCounts).length > 0
        ? "partial"
        : warnings.length > 0
          ? "completed_with_warnings"
          : "completed";
    await updateRunReport(db, runId, status, startedAt, perLenderCounts, warnings);

    return {
      ok: true,
      runId,
      perLenderCounts,
      warnings: warnings.length > 0 ? warnings : undefined,
      status,
      sourceUrl: lastUrl,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("discoverCdrRegister", e);
    await updateRunReport(db, runId, "failed", startedAt, null, [msg]);
    return { ok: false, runId, error: msg, status: "failed" };
  }
}

function extractBrands(data: unknown): RegisterBrand[] {
  if (Array.isArray(data)) return data as RegisterBrand[];
  if (data != null && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as RegisterBrand[];
    if (Array.isArray(o.dataHolderBrands)) return o.dataHolderBrands as RegisterBrand[];
    if (Array.isArray(o.brands)) return o.brands as RegisterBrand[];
    if (Array.isArray(o.dataHolderBrandsSummary)) return o.dataHolderBrandsSummary as RegisterBrand[];
  }
  return [];
}

async function updateRunReport(
  db: D1Database,
  runId: string,
  status: string,
  startedAt: string,
  perLenderJson: Record<string, number> | null,
  errorsJson: string[]
): Promise<void> {
  const finishedAt = nowIso();
  try {
    await db
      .prepare(
        "UPDATE run_reports SET status = ?, finished_at = ?, per_lender_json = ?, errors_json = ? WHERE run_id = ?"
      )
      .bind(
        status,
        finishedAt,
        perLenderJson ? JSON.stringify(perLenderJson) : null,
        errorsJson.length > 0 ? JSON.stringify(errorsJson) : null,
        runId
      )
      .run();
  } catch (e) {
    console.error("updateRunReport", e);
  }
}

/** Create run_reports row for a run (scheduled or manual). */
export async function insertRunReport(
  db: D1Database,
  runId: string,
  runType: string,
  lockKey?: string
): Promise<void> {
  const startedAt = nowIso();
  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO run_reports (run_id, run_type, started_at, status) VALUES (?, ?, ?, ?)"
      )
      .bind(runId, runType, startedAt, "running")
      .run();
  } catch (e) {
    console.error("insertRunReport", e);
  }
}

/** Get discovery health: last run, cache count, optional live check. */
export async function getDiscoveryHealth(db: D1Database): Promise<{
  ok: boolean;
  lastRun: { run_id: string; status: string; finished_at: string | null } | null;
  cachedEndpointsCount: number;
  lastSuccessAt: string | null;
  statusCounts: Record<string, number>;
}> {
  try {
    const lastRunRow = await db
      .prepare(
        "SELECT run_id, status, finished_at FROM run_reports WHERE run_type IN ('daily','manual_discover') ORDER BY started_at DESC LIMIT 1"
      )
      .first<{ run_id: string; status: string; finished_at: string | null }>();

    const countResult = await db
      .prepare("SELECT COUNT(*) AS c FROM lender_endpoints_cache")
      .first<{ c: number }>();
    const cachedEndpointsCount = countResult?.c ?? 0;

    const lastSuccess = await db
      .prepare(
        "SELECT finished_at FROM run_reports WHERE status IN ('completed','completed_with_warnings','partial') AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1"
      )
      .first<{ finished_at: string }>();
    const lastSuccessAt = lastSuccess?.finished_at ?? null;

    const statusRows = await db
      .prepare(
        "SELECT status, COUNT(*) AS cnt FROM run_reports GROUP BY status"
      )
      .all();
    const statusCounts: Record<string, number> = {};
    for (const row of Array.isArray((statusRows as any)?.results) ? (statusRows as any).results : []) {
      const s = (row as any)?.status as string;
      const n = (row as any)?.cnt as number;
      if (s != null) statusCounts[s] = n;
    }

    return {
      ok: true,
      lastRun: lastRunRow ?? null,
      cachedEndpointsCount,
      lastSuccessAt,
      statusCounts,
    };
  } catch (e) {
    console.error("getDiscoveryHealth", e);
    return {
      ok: false,
      lastRun: null,
      cachedEndpointsCount: 0,
      lastSuccessAt: null,
      statusCounts: {},
    };
  }
}
