# Local Manual CDR Ingest

Real public CDR product-reference ingest for local analysis.

## Daily run

```powershell
python .\cdr_daily.py --workers 8
```

`cdr_daily.py` writes one completion marker per local date under `.daily-state/`.
It skips the date after a successful ingest/export unless `--force` is set.
Unknown arguments are passed through to `cdr_full_ingest.py`, so filters such as
`--holders anz`, `--no-energy`, or `--max-pages 2` still work.

Install a Windows daily scheduled task:

```powershell
.\install_daily_task.ps1 -At 03:15 -ExtraArgs "--workers 8"
```

## Build exports for an existing run

```powershell
python .\cdr_outputs.py .\runs\2026-05-06
```

Outputs are written to `runs/<date>/_exports/`:

- `banks-<date>.json`
- `energy-<date>.json`
- `banks-<date>.xlsx`
- `energy-<date>.xlsx`
- `local-cdr.sqlite`
- `dashboard-cache/`

Generated JSON strips CDR links, URI/URL fields, and URLs embedded in text while
retaining rates, fees, constraints, eligibility, features, contract sections, and
the cleaned full detail JSON for each product or plan.

## Local dashboard

```powershell
python .\cdr_dashboard_server.py --exports .\runs\2026-05-06\_exports
```

Open `http://127.0.0.1:8799/`.

The dashboard serves precomputed cache files with `Cache-Control: public,
max-age=300` and keeps file contents in memory until the file timestamp changes.
