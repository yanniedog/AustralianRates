"""Build local CDR JSON, XLSX, SQLite, and dashboard cache artifacts."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from cdr_clean_export import parse_banks_run, parse_energy_run, summary_counts, utc_now
from cdr_xlsx import write_workbook

TABLE_COLUMNS: Dict[str, List[str]] = {
    "runs": ["run_date", "generated_at", "banks_counts_json", "energy_counts_json"],
    "bank_products": [
        "run_date",
        "dataset",
        "provider",
        "product_id",
        "product_key",
        "product_name",
        "category",
        "last_updated",
        "source_file",
        "details_json",
    ],
    "bank_rates": [
        "run_date",
        "dataset",
        "provider",
        "product_id",
        "product_key",
        "product_name",
        "rate_family",
        "rate",
        "comparison_rate",
        "rate_type",
        "application_type",
        "application_frequency",
        "repayment_type",
        "loan_purpose",
        "term",
        "details_json",
    ],
    "bank_items": [
        "run_date",
        "item_group",
        "dataset",
        "provider",
        "product_id",
        "product_key",
        "product_name",
        "item_type",
        "name",
        "value",
        "details_json",
    ],
    "energy_plans": [
        "run_date",
        "provider",
        "plan_id",
        "plan_name",
        "fuel_type",
        "last_updated",
        "source_file",
        "details_json",
    ],
    "energy_items": [
        "run_date",
        "item_group",
        "provider",
        "plan_id",
        "plan_name",
        "item_type",
        "name",
        "value",
        "details_json",
    ],
}


def write_json(path: Path, data: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def row_for_columns(row: Mapping[str, Any], columns: List[str]) -> List[Any]:
    return [row.get(col, "") for col in columns]


def ensure_db(con: sqlite3.Connection) -> None:
    if needs_schema_reset(con):
        reset_schema(con)
    con.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS runs (
          run_date TEXT PRIMARY KEY,
          generated_at TEXT NOT NULL,
          banks_counts_json TEXT NOT NULL,
          energy_counts_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bank_products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_date TEXT NOT NULL,
          dataset TEXT NOT NULL,
          provider TEXT NOT NULL,
          product_id TEXT NOT NULL,
          product_key TEXT NOT NULL,
          product_name TEXT NOT NULL,
          category TEXT,
          last_updated TEXT,
          source_file TEXT NOT NULL,
          details_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bank_rates (
          run_date TEXT NOT NULL,
          dataset TEXT NOT NULL,
          provider TEXT NOT NULL,
          product_id TEXT NOT NULL,
          product_key TEXT NOT NULL,
          product_name TEXT NOT NULL,
          rate_family TEXT NOT NULL,
          rate TEXT,
          comparison_rate TEXT,
          rate_type TEXT,
          application_type TEXT,
          application_frequency TEXT,
          repayment_type TEXT,
          loan_purpose TEXT,
          term TEXT,
          details_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bank_items (
          run_date TEXT NOT NULL,
          item_group TEXT NOT NULL,
          dataset TEXT NOT NULL,
          provider TEXT NOT NULL,
          product_id TEXT NOT NULL,
          product_key TEXT NOT NULL,
          product_name TEXT NOT NULL,
          item_type TEXT,
          name TEXT,
          value TEXT,
          details_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS energy_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_date TEXT NOT NULL,
          provider TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          plan_name TEXT NOT NULL,
          fuel_type TEXT,
          last_updated TEXT,
          source_file TEXT NOT NULL,
          details_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS energy_items (
          run_date TEXT NOT NULL,
          item_group TEXT NOT NULL,
          provider TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          plan_name TEXT NOT NULL,
          item_type TEXT,
          name TEXT,
          value TEXT,
          details_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bank_rates_lookup
          ON bank_rates (run_date, dataset, provider, rate_family);
        CREATE INDEX IF NOT EXISTS idx_bank_products_provider
          ON bank_products (run_date, dataset, provider);
        CREATE INDEX IF NOT EXISTS idx_energy_items_lookup
          ON energy_items (run_date, provider, item_group);
        """
    )


def needs_schema_reset(con: sqlite3.Connection) -> bool:
    rows = con.execute("PRAGMA table_info(bank_products)").fetchall()
    if rows and any(row[5] for row in rows):
        return True
    columns = {row[1] for row in rows}
    return bool(rows) and "source_file" not in columns


def reset_schema(con: sqlite3.Connection) -> None:
    for table in (
        "bank_products",
        "bank_rates",
        "bank_items",
        "energy_plans",
        "energy_items",
        "runs",
    ):
        con.execute(f"DROP TABLE IF EXISTS {table}")


def insert_rows(con: sqlite3.Connection, table: str, rows: List[Mapping[str, Any]]) -> None:
    if not rows:
        return
    columns = TABLE_COLUMNS[table]
    placeholders = ",".join("?" for _ in columns)
    sql = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})"
    con.executemany(sql, [row_for_columns(row, columns) for row in rows])


def rebuild_run_db(db_path: Path, run_date: str, banks: Mapping[str, Any], energy: Mapping[str, Any]) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as con:
        ensure_db(con)
        for table in TABLE_COLUMNS:
            if table != "runs":
                con.execute(f"DELETE FROM {table} WHERE run_date = ?", (run_date,))
        con.execute("DELETE FROM runs WHERE run_date = ?", (run_date,))
        con.execute(
            "INSERT INTO runs VALUES (?, ?, ?, ?)",
            (
                run_date,
                utc_now(),
                json.dumps(summary_counts(banks), sort_keys=True),
                json.dumps(summary_counts(energy), sort_keys=True),
            ),
        )
        insert_rows(con, "bank_products", banks["products"])
        insert_rows(con, "bank_rates", banks["rates"])
        for group in ("fees", "features", "eligibility", "constraints"):
            insert_rows(con, "bank_items", add_group(banks[group], group))
        insert_rows(con, "energy_plans", energy["plans"])
        for group in ("contracts", "charges", "fees"):
            insert_rows(con, "energy_items", add_group(energy[group], group))


def add_group(rows: List[Mapping[str, Any]], group: str) -> List[Dict[str, Any]]:
    return [{**row, "item_group": group} for row in rows]


def write_sector_workbooks(out_dir: Path, run_date: str, banks: Mapping[str, Any], energy: Mapping[str, Any]) -> None:
    write_workbook(
        out_dir / f"banks-{run_date}.xlsx",
        {
            "products": banks["products"],
            "rates": banks["rates"],
            "fees": banks["fees"],
            "features": banks["features"],
            "eligibility": banks["eligibility"],
            "constraints": banks["constraints"],
            "failures": banks["failures"],
        },
    )
    write_workbook(
        out_dir / f"energy-{run_date}.xlsx",
        {
            "plans": energy["plans"],
            "contracts": energy["contracts"],
            "charges": energy["charges"],
            "fees": energy["fees"],
            "failures": energy["failures"],
        },
    )


def write_dashboard_cache(out_dir: Path, run_date: str, banks: Mapping[str, Any], energy: Mapping[str, Any]) -> None:
    cache_dir = out_dir / "dashboard-cache" / run_date
    banks_cache = {
        "run_date": run_date,
        "products": banks["products"],
        "rates": banks["rates"],
        "counts": summary_counts(banks),
    }
    energy_cache = {
        "run_date": run_date,
        "plans": energy["plans"],
        "charges": energy["charges"],
        "counts": summary_counts(energy),
    }
    manifest = {
        "generated_at": utc_now(),
        "run_date": run_date,
        "banks_counts": banks_cache["counts"],
        "energy_counts": energy_cache["counts"],
        "files": {
            "banks_json": f"banks-{run_date}.json",
            "energy_json": f"energy-{run_date}.json",
            "banks_xlsx": f"banks-{run_date}.xlsx",
            "energy_xlsx": f"energy-{run_date}.xlsx",
            "db": "local-cdr.sqlite",
        },
    }
    write_json(cache_dir / "banks.json", banks_cache)
    write_json(cache_dir / "energy.json", energy_cache)
    write_json(cache_dir / "manifest.json", manifest)
    write_json(out_dir / "dashboard-cache" / "latest.json", manifest)


def build_outputs(run_root: Path, out_dir: Optional[Path] = None, db_path: Optional[Path] = None) -> Dict[str, Any]:
    out_dir = (out_dir or (run_root / "_exports")).resolve()
    run_date = run_root.name
    banks = parse_banks_run(run_root)
    energy = parse_energy_run(run_root)
    write_json(out_dir / f"banks-{run_date}.json", banks)
    write_json(out_dir / f"energy-{run_date}.json", energy)
    write_sector_workbooks(out_dir, run_date, banks, energy)
    rebuild_run_db(db_path or (out_dir / "local-cdr.sqlite"), run_date, banks, energy)
    write_dashboard_cache(out_dir, run_date, banks, energy)
    return {"run_date": run_date, "out_dir": str(out_dir), "banks": summary_counts(banks), "energy": summary_counts(energy)}


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build local CDR exports from one run folder.")
    parser.add_argument("run_root", type=Path, help="Run date folder, e.g. runs/2026-05-06")
    parser.add_argument("--out", type=Path, default=None, help="Export folder (default: <run>/_exports)")
    parser.add_argument("--db", type=Path, default=None, help="SQLite path (default: <out>/local-cdr.sqlite)")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    result = build_outputs(args.run_root.expanduser().resolve(), args.out, args.db)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
