#!/usr/bin/env python3
"""
Standalone Australian banking CDR product-reference-data (PRD) ingest.

Fetches all product-holder brands from the ACCC CDR register, walks each holder's
public GET /cds-au/v1/banking/products index (paginated), classifies products into
Mortgage / Savings / TD using CDS-style categories (aligned with Australian Rates
ingest logic), and saves each product detail response to disk.

Usage:
  python cdr_full_ingest.py [--out DIR] [--date YYYY-MM-DD] [--resume]
  python cdr_full_ingest.py --holders commbank --max-pages 2 --max-products 50

Default run date folder uses UTC (YYYY-MM-DD). Output layout:

  <out>/<YYYY-MM-DD>/Mortgage/<Bank>/<ProductName>/<productId>/product-detail.json
  <out>/<YYYY-MM-DD>/Savings/...
  <out>/<YYYY-MM-DD>/TD/...

Holder-level register snapshot and paginated index payloads:

  <out>/<YYYY-MM-DD>/_holders/<Bank>/_register-brand.json
  <out>/<YYYY-MM-DD>/_holders/<Bank>/_products-index/page-0001.json

Failed detail GET bodies are written as product-detail.error.txt next to the leaf folder;
resume skips only successful product-detail.json files.

Public PRD only — no consumer consent, no Cloudflare, no Australian Rates API.

References (external standards):
  Consumer Data Standards banking PRD: product list + product detail endpoints.
  Register: https://api.cdr.gov.au/cdr-register/v1/
"""

from __future__ import annotations

import argparse
import json
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Set, Tuple

# -----------------------------------------------------------------------------
# Constants (mirror workers/api/src/ingest/cdr/discovery.ts + http.ts order)
# -----------------------------------------------------------------------------

REGISTER_URL_SUMMARY = (
    "https://api.cdr.gov.au/cdr-register/v1/all/data-holders/brands/summary"
)
REGISTER_URL_BANKING_BRANDS = (
    "https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands"
)
REGISTER_URL_BANKING_REGISTER = (
    "https://api.cdr.gov.au/cdr-register/v1/banking/register"
)

# Bank PRD endpoints often negotiate newer x-v; CDR register currently responds at v2 in practice.
REGISTER_FETCH_VERSIONS = [2, 1, 6, 5, 4, 3]
CDR_VERSION_ORDER = [6, 5, 4, 3, 2, 1]

DATASET_CATEGORY_ALIASES: Dict[str, List[str]] = {
    "home_loans": [
        "RESIDENTIAL_MORTGAGES",
        "RESIDENTIAL_MORTGAGE",
        "MORTGAGES",
        "MORTGAGE",
        "HOME_LOANS",
        "HOME_LOAN",
    ],
    "savings": [
        "TRANS_AND_SAVINGS_ACCOUNTS",
        "TRANS_AND_SAVINGS_ACCOUNT",
        "TRANS_AND_SAVINGS",
        "SAVINGS_ACCOUNTS",
        "SAVINGS_ACCOUNT",
        "SAVINGS",
        "TRANSACTION_AND_SAVINGS_ACCOUNTS",
    ],
    "term_deposits": [
        "TERM_DEPOSITS",
        "TERM_DEPOSIT",
        "FIXED_TERM_DEPOSITS",
        "FIXED_TERM_DEPOSIT",
        "FIXED_DEPOSITS",
        "FIXED_DEPOSIT",
    ],
}

DATASET_TO_FOLDER = {
    "home_loans": "Mortgage",
    "savings": "Savings",
    "term_deposits": "TD",
}


# -----------------------------------------------------------------------------
# JSON primitives (subset of workers/api/src/ingest/cdr/primitives.ts)
# -----------------------------------------------------------------------------


def is_record(value: Any) -> bool:
    return isinstance(value, dict)


def as_array(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return []


def pick_text(record: Mapping[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        raw = record.get(key)
        if raw is None:
            continue
        text = str(raw).strip()
        if text:
            return text
    return ""


def safe_url(value: str) -> str:
    return value.rstrip("/")


def has_cdr_errors(data: Any) -> bool:
    if not is_record(data):
        return False
    errs = data.get("errors")
    if isinstance(errs, list) and len(errs) > 0:
        return True
    ec = str(data.get("errorCode") or "").strip()
    em = str(data.get("errorMessage") or "").strip()
    return bool(ec or em)


def parse_supported_versions(body: str) -> List[int]:
    available = re.search(r"Versions available:\s*([0-9,\s]+)", body, re.I)
    if available:
        parts = [x.strip() for x in available.group(1).split(",")]
        out: List[int] = []
        for p in parts:
            if p.isdigit():
                out.append(int(p))
        return out

    range_m = re.search(
        r"Minimum version supported is\s*(\d+)\s*and\s*Maximum version supported is\s*(\d+)",
        body,
        re.I,
    )
    if not range_m:
        return []
    lo, hi = int(range_m.group(1)), int(range_m.group(2))
    if lo > hi:
        return []
    return list(range(hi, lo - 1, -1))


# -----------------------------------------------------------------------------
# Classification (mirror workers/api/src/ingest/cdr/product-classification.ts)
# -----------------------------------------------------------------------------


def normalize_category_token(value: str) -> str:
    text = str(value or "").strip().upper()
    text = re.sub(r"[^A-Z0-9]+", "_", text)
    return text.strip("_")


def normalize_cdr_product_category(value: Any) -> Optional[str]:
    token = normalize_category_token(str(value or ""))
    return token if token else None


def extract_cdr_product_category(product: Mapping[str, Any]) -> Optional[str]:
    raw = pick_text(product, ["productCategory", "category", "type"])
    return normalize_cdr_product_category(raw)


def dataset_from_cdr_category(category: Optional[str]) -> Optional[str]:
    normalized = normalize_cdr_product_category(category or "")
    if not normalized:
        return None
    for dataset, aliases in DATASET_CATEGORY_ALIASES.items():
        if normalized in aliases:
            return dataset
    if "MORTGAGE" in normalized or "HOME_LOAN" in normalized:
        return "home_loans"
    if "TERM_DEPOSIT" in normalized or "FIXED_DEPOSIT" in normalized:
        return "term_deposits"
    if "SAVINGS" in normalized or "TRANS_AND_SAVINGS" in normalized:
        return "savings"
    return None


def has_mortgage_structured_signals(product: Mapping[str, Any]) -> bool:
    rates = [x for x in as_array(product.get("lendingRates")) if is_record(x)]
    if not rates:
        return False
    for rate in rates:
        if not is_record(rate):
            continue
        lp = pick_text(rate, ["loanPurpose"])
        rt = pick_text(rate, ["repaymentType"])
        lrt = pick_text(rate, ["lendingRateType"])
        if lp or rt or lrt:
            return True
    return False


def has_deposit_structured_signals(product: Mapping[str, Any]) -> bool:
    dr = [x for x in as_array(product.get("depositRates")) if is_record(x)]
    if dr:
        return True
    generic = [x for x in as_array(product.get("rates")) if is_record(x)]
    for rate in generic:
        if not is_record(rate):
            continue
        dt = pick_text(rate, ["depositRateType", "rateType"])
        at = pick_text(rate, ["applicationType", "rateApplicabilityType"])
        if dt or at:
            return True
    return False


def infer_dataset_from_structured_signals(product: Mapping[str, Any]) -> Optional[str]:
    if has_mortgage_structured_signals(product):
        return "home_loans"
    if has_deposit_structured_signals(product):
        cat_ds = dataset_from_cdr_category(extract_cdr_product_category(product))
        if cat_ds:
            return cat_ds
        return "savings"
    return None


def infer_dataset_from_name(product: Mapping[str, Any]) -> Optional[str]:
    name = pick_text(product, ["name", "productName"]).upper()
    if not name:
        return None
    if "MORTGAGE" in name or "HOME LOAN" in name:
        return "home_loans"
    if "TERM DEPOSIT" in name or "FIXED DEPOSIT" in name:
        return "term_deposits"
    if "SAVINGS" in name or "SAVER" in name or "AT CALL" in name:
        return "savings"
    return None


def infer_cdr_dataset(
    product: Mapping[str, Any],
    *,
    allow_name_fallback: bool = True,
) -> Optional[str]:
    cat_ds = dataset_from_cdr_category(extract_cdr_product_category(product))
    if cat_ds:
        return cat_ds
    structured = infer_dataset_from_structured_signals(product)
    if structured:
        return structured
    if not allow_name_fallback:
        return None
    return infer_dataset_from_name(product)


def detail_inner_record(parsed: Any) -> Optional[Dict[str, Any]]:
    if not is_record(parsed):
        return None
    inner = parsed.get("data")
    if is_record(inner):
        return inner
    return parsed  # type: ignore[return-value]


# -----------------------------------------------------------------------------
# Register + product list parsing (discovery.ts)
# -----------------------------------------------------------------------------


def extract_brands(payload: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if is_record(payload):
        data_array = as_array(payload.get("data"))
    else:
        data_array = as_array(payload)

    for item in data_array:
        if not is_record(item):
            continue
        brand_name = pick_text(item, ["brandName", "dataHolderBrandName"])
        legal_entity = item.get("legalEntity")
        legal_name = ""
        if is_record(legal_entity):
            legal_name = pick_text(legal_entity, ["legalEntityName"])

        endpoint_detail = item.get("endpointDetail")
        ed: Mapping[str, Any] = endpoint_detail if is_record(endpoint_detail) else {}

        endpoint_raw = (
            pick_text(ed, ["productReferenceDataApi", "publicBaseUri", "resourceBaseUri"])
            or pick_text(item, ["publicBaseUri", "resourceBaseUri"])
        )
        if not endpoint_raw:
            continue

        if "/cds-au/v1/banking/products" in endpoint_raw:
            endpoint_url = safe_url(endpoint_raw)
        else:
            endpoint_url = safe_url(endpoint_raw) + "/cds-au/v1/banking/products"

        out.append(
            {
                "brand_name": brand_name,
                "legal_entity_name": legal_name,
                "endpoint_url": endpoint_url,
            }
        )
    return out


def extract_products(payload: Any) -> List[Dict[str, Any]]:
    if not is_record(payload):
        return []
    data = payload.get("data")
    if is_record(data):
        inner = data.get("products")
        seq = as_array(inner)
    else:
        seq = as_array(data)
    return [x for x in seq if is_record(x)]


def next_link(payload: Any, current_url: str) -> Optional[str]:
    if not is_record(payload):
        return None
    links = payload.get("links")
    if not is_record(links):
        return None
    nxt = str(links.get("next") or "").strip()
    if not nxt:
        return None
    return urllib.parse.urljoin(current_url + "/", nxt)


# -----------------------------------------------------------------------------
# HTTP (mirror workers/api/src/ingest/cdr/http.ts fetchCdrJson / fetchJson)
# -----------------------------------------------------------------------------


@dataclass
class FetchResult:
    ok: bool
    status: int
    url: str
    text: str

    @property
    def data(self) -> Any:
        try:
            return json.loads(self.text)
        except json.JSONDecodeError:
            return None


def http_request(
    url: str,
    headers: Dict[str, str],
    *,
    timeout: float,
) -> Tuple[int, str]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.getcode(), body
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = str(e)
        return int(e.code), body
    except Exception as e:
        return 599, str(e)


def fetch_with_retries(
    url: str,
    headers: Dict[str, str],
    *,
    timeout: float,
    max_retries: int,
    sleep_ms: int,
    retry_on: Callable[[int], bool],
) -> FetchResult:
    attempt = 0
    last_status = 0
    last_text = ""
    while attempt <= max_retries:
        attempt += 1
        status, text = http_request(url, headers, timeout=timeout)
        last_status, last_text = status, text
        if status < 400 or not retry_on(status):
            return FetchResult(ok=status < 400, status=status, url=url, text=text)
        # backoff + jitter
        base = min(2 ** (attempt - 1), 32)
        jitter = random.uniform(0, 0.25 * base)
        time.sleep(base + jitter + sleep_ms / 1000.0)
    return FetchResult(ok=False, status=last_status, url=url, text=last_text)


def retryable_status(status: int) -> bool:
    return status == 429 or status >= 500


def fetch_json_plain(
    url: str,
    *,
    timeout: float,
    max_retries: int,
    sleep_ms: int,
) -> FetchResult:
    headers = {"Accept": "application/json"}
    return fetch_with_retries(
        url,
        headers,
        timeout=timeout,
        max_retries=max_retries,
        sleep_ms=sleep_ms,
        retry_on=retryable_status,
    )


def fetch_cdr_json(
    url: str,
    *,
    versions: Optional[List[int]] = None,
    timeout: float,
    max_retries: int,
    sleep_ms: int,
) -> FetchResult:
    queue = list(versions or CDR_VERSION_ORDER)
    tried: Set[int] = set()

    def hdr(v: int) -> Dict[str, str]:
        return {
            "Accept": "application/json",
            "x-v": str(v),
            "x-min-v": str(v),
        }

    last: Optional[FetchResult] = None
    while queue:
        v = queue.pop(0)
        if v in tried:
            continue
        tried.add(v)
        res = fetch_with_retries(
            url,
            hdr(v),
            timeout=timeout,
            max_retries=max_retries,
            sleep_ms=sleep_ms,
            retry_on=retryable_status,
        )
        last = res
        data = json.loads(res.text) if res.text else None
        if res.ok and data is not None and not has_cdr_errors(data):
            return FetchResult(ok=True, status=res.status, url=url, text=res.text)

        if res.status == 406:
            advertised = parse_supported_versions(res.text)
            for x in advertised:
                if x not in tried:
                    queue.append(x)

    for fb in CDR_VERSION_ORDER:
        if fb in tried:
            continue
        res = fetch_with_retries(
            url,
            hdr(fb),
            timeout=timeout,
            max_retries=max_retries,
            sleep_ms=sleep_ms,
            retry_on=retryable_status,
        )
        last = res
        data = json.loads(res.text) if res.text else None
        if res.ok and data is not None and not has_cdr_errors(data):
            return FetchResult(ok=True, status=res.status, url=url, text=res.text)

    assert last is not None
    return FetchResult(ok=False, status=last.status, url=url, text=last.text)


# -----------------------------------------------------------------------------
# Filesystem
# -----------------------------------------------------------------------------

INVALID_PATH_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_path_component(name: str, fallback: str = "_") -> str:
    text = str(name or "").strip()
    text = INVALID_PATH_CHARS.sub("_", text)
    text = text.strip(" .")
    return text if text else fallback


def host_token(endpoint_url: str) -> str:
    try:
        host = urllib.parse.urlparse(endpoint_url).hostname or ""
    except Exception:
        host = ""
    host = host.lower().replace(".", "_")
    return sanitize_path_component(host, "_host")


def allocate_bank_dir(
    brand_name: str,
    legal_name: str,
    endpoint_url: str,
    seen_base: Set[str],
) -> str:
    base = sanitize_path_component(brand_name or legal_name or "unknown_bank")
    candidate = base
    suffix = host_token(endpoint_url)
    if candidate not in seen_base:
        seen_base.add(candidate)
        return candidate
    candidate = f"{base}_{suffix}"
    n = 2
    while candidate in seen_base:
        candidate = f"{base}_{suffix}_{n}"
        n += 1
    seen_base.add(candidate)
    return candidate


def append_failure(date_root: Path, row: Dict[str, Any]) -> None:
    path = date_root / "failures.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


# -----------------------------------------------------------------------------
# Core ingest
# -----------------------------------------------------------------------------


def collect_register_brands(
    *,
    timeout: float,
    max_retries: int,
    sleep_ms: int,
    holders_filter: Optional[str],
) -> List[Dict[str, str]]:
    merged: Dict[Tuple[str, str, str], Dict[str, str]] = {}

    attempts: List[Tuple[str, str]] = [
        (REGISTER_URL_SUMMARY, "cdr"),
        (REGISTER_URL_BANKING_BRANDS, "plain"),
        (REGISTER_URL_BANKING_REGISTER, "plain"),
    ]

    for url, mode in attempts:
        res = (
            fetch_cdr_json(
                url,
                versions=REGISTER_FETCH_VERSIONS,
                timeout=timeout,
                max_retries=max_retries,
                sleep_ms=sleep_ms,
            )
            if mode == "cdr"
            else fetch_json_plain(url, timeout=timeout, max_retries=max_retries, sleep_ms=sleep_ms)
        )
        data = json.loads(res.text) if res.text else None
        if not res.ok or data is None or has_cdr_errors(data):
            continue
        for b in extract_brands(data):
            key = (
                b["endpoint_url"].lower(),
                (b["brand_name"] or "").lower(),
                (b["legal_entity_name"] or "").lower(),
            )
            merged[key] = b

    brands = list(merged.values())
    if holders_filter:
        hf = holders_filter.lower()
        brands = [
            b
            for b in brands
            if hf in (b["brand_name"] or "").lower()
            or hf in (b["legal_entity_name"] or "").lower()
            or hf in (b["endpoint_url"] or "").lower()
        ]
    brands.sort(key=lambda x: (x["brand_name"] or x["legal_entity_name"] or "").lower())
    return brands


def classify_product_for_ingest(
    product: Mapping[str, Any],
    *,
    fetch_unknown_detail: bool,
    endpoint_url: str,
    timeout: float,
    max_retries: int,
    sleep_ms: int,
) -> Tuple[Optional[str], Optional[FetchResult]]:
    """Returns (dataset_kind or None, optional detail_fetch_if_unknown_path)."""
    ds = infer_cdr_dataset(product, allow_name_fallback=True)
    if ds in DATASET_TO_FOLDER:
        return ds, None
    if not fetch_unknown_detail:
        return None, None

    pid = pick_text(product, ["productId", "id"])
    if not pid:
        return None, None

    detail_url = f"{safe_url(endpoint_url)}/{urllib.parse.quote(pid, safe='')}"
    detail_res = fetch_cdr_json(
        detail_url,
        timeout=timeout,
        max_retries=max_retries,
        sleep_ms=sleep_ms,
    )
    parsed = json.loads(detail_res.text) if detail_res.text else None
    inner = detail_inner_record(parsed)
    if inner is None:
        return None, detail_res

    ds2 = infer_cdr_dataset(inner, allow_name_fallback=True)
    if ds2 in DATASET_TO_FOLDER:
        return ds2, detail_res
    return None, detail_res


def ingest_brand(
    brand: Dict[str, str],
    *,
    date_root: Path,
    resume: bool,
    sleep_ms: int,
    timeout: float,
    max_retries: int,
    max_pages: Optional[int],
    max_products: Optional[int],
    fetch_unknown_detail: bool,
    bank_dir_name: str,
    log: Callable[[str], None],
) -> None:
    endpoint_url = brand["endpoint_url"]
    # Holder-level artifacts live beside Mortgage/Savings/TD so the product tree matches the plan.
    holders_root = date_root / "_holders" / bank_dir_name
    holders_root.mkdir(parents=True, exist_ok=True)

    meta_path = holders_root / "_register-brand.json"
    if not meta_path.exists():
        meta_path.write_text(json.dumps(brand, indent=2, ensure_ascii=False), encoding="utf-8")

    index_dir = holders_root / "_products-index"
    index_dir.mkdir(parents=True, exist_ok=True)

    url: Optional[str] = endpoint_url
    visited: Set[str] = set()
    pages = 0
    products_seen = 0

    while url:
        if url in visited:
            break
        visited.add(url)
        pages += 1
        if max_pages is not None and pages > max_pages:
            log(f"max-pages reached for {bank_dir_name}")
            break

        time.sleep(sleep_ms / 1000.0)
        res = fetch_cdr_json(url, timeout=timeout, max_retries=max_retries, sleep_ms=sleep_ms)
        page_file = index_dir / f"page-{pages:04d}.json"
        page_file.write_text(res.text, encoding="utf-8")

        parsed = json.loads(res.text) if res.text else None
        if not res.ok or parsed is None or has_cdr_errors(parsed):
            append_failure(
                date_root,
                {
                    "phase": "products_index",
                    "bank": bank_dir_name,
                    "url": url,
                    "status": res.status,
                    "snippet": (res.text or "")[:500],
                },
            )
            break

        products = extract_products(parsed)
        for product in products:
            if max_products is not None and products_seen >= max_products:
                log(f"max-products reached for {bank_dir_name}")
                return
            products_seen += 1

            if not is_record(product):
                continue

            pid = pick_text(product, ["productId", "id"])
            if not pid:
                continue

            ds, prefetched_detail = classify_product_for_ingest(
                product,
                fetch_unknown_detail=fetch_unknown_detail,
                endpoint_url=endpoint_url,
                timeout=timeout,
                max_retries=max_retries,
                sleep_ms=sleep_ms,
            )
            if ds not in DATASET_TO_FOLDER:
                continue

            folder = DATASET_TO_FOLDER[ds]
            pname = sanitize_path_component(
                pick_text(product, ["name", "productName"]) or "_unnamed"
            )

            leaf = date_root / folder / bank_dir_name / pname / pid
            leaf.mkdir(parents=True, exist_ok=True)
            detail_path = leaf / "product-detail.json"

            if resume and detail_path.exists() and detail_path.stat().st_size > 0:
                continue

            if prefetched_detail is not None:
                detail_res = prefetched_detail
            else:
                time.sleep(sleep_ms / 1000.0)
                detail_url = f"{safe_url(endpoint_url)}/{urllib.parse.quote(pid, safe='')}"
                detail_res = fetch_cdr_json(
                    detail_url,
                    timeout=timeout,
                    max_retries=max_retries,
                    sleep_ms=sleep_ms,
                )

            parsed_detail = json.loads(detail_res.text) if detail_res.text else None
            ok = (
                detail_res.ok
                and parsed_detail is not None
                and not has_cdr_errors(parsed_detail)
            )
            if ok:
                detail_path.write_text(detail_res.text, encoding="utf-8")
            else:
                append_failure(
                    date_root,
                    {
                        "phase": "product_detail",
                        "bank": bank_dir_name,
                        "product_id": pid,
                        "dataset": folder,
                        "status": detail_res.status,
                        "snippet": (detail_res.text or "")[:500],
                    },
                )
                err_path = leaf / "product-detail.error.txt"
                err_path.write_text(detail_res.text or "", encoding="utf-8")

        nxt = next_link(parsed, url)
        url = nxt


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    default_out = here / "runs"

    p = argparse.ArgumentParser(description="Standalone Australian banking CDR PRD full ingest.")
    p.add_argument(
        "--out",
        type=Path,
        default=default_out,
        help=f"Output root (default: {default_out})",
    )
    p.add_argument(
        "--date",
        type=str,
        default=None,
        help="Run folder YYYY-MM-DD (default: UTC today)",
    )
    p.add_argument("--resume", action="store_true", help="Skip existing non-empty product-detail.json")
    p.add_argument(
        "--sleep-ms",
        type=int,
        default=40,
        help="Delay between HTTP calls (milliseconds)",
    )
    p.add_argument("--timeout", type=float, default=60.0, help="Per-request timeout seconds")
    p.add_argument("--max-retries", type=int, default=3, help="Retries on 429/5xx")
    p.add_argument(
        "--holders",
        type=str,
        default=None,
        help="Substring filter on brand name, legal name, or endpoint URL",
    )
    p.add_argument("--max-pages", type=int, default=None, help="Cap index pages per holder")
    p.add_argument("--max-products", type=int, default=None, help="Cap products processed per holder")
    p.add_argument(
        "--fetch-unknown-detail",
        action="store_true",
        help="GET detail once when list classification is ambiguous; classify from detail body",
    )
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    run_date = args.date
    if not run_date:
        run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    out_root: Path = args.out.expanduser().resolve()
    date_root = out_root / run_date

    def log(msg: str) -> None:
        print(msg, file=sys.stderr)

    log(f"Output root: {date_root} (UTC date folder unless --date set)")
    date_root.mkdir(parents=True, exist_ok=True)

    brands = collect_register_brands(
        timeout=args.timeout,
        max_retries=args.max_retries,
        sleep_ms=args.sleep_ms,
        holders_filter=args.holders,
    )
    log(f"Discovered {len(brands)} register brand rows with PRD endpoints")

    seen_bank_dirs: Set[str] = set()

    for brand in brands:
        bank_dir = allocate_bank_dir(
            brand["brand_name"],
            brand["legal_entity_name"],
            brand["endpoint_url"],
            seen_bank_dirs,
        )
        log(f"Ingesting {bank_dir} ({brand['endpoint_url']})")
        ingest_brand(
            brand,
            date_root=date_root,
            resume=args.resume,
            sleep_ms=args.sleep_ms,
            timeout=args.timeout,
            max_retries=args.max_retries,
            max_pages=args.max_pages,
            max_products=args.max_products,
            fetch_unknown_detail=args.fetch_unknown_detail,
            bank_dir_name=bank_dir,
            log=log,
        )

    log("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
