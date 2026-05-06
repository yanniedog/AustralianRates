"""Cached local dashboard for generated CDR run artifacts."""

from __future__ import annotations

import argparse
import errno
import json
import mimetypes
import socket
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Tuple
from urllib.parse import parse_qs, urlparse

HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Australian Rates local CDR</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header><strong>Australian Rates</strong><span>Local CDR</span><select id="date"></select></header>
<main>
<section class="toolbar">
<button data-sector="banks" class="active">Banks</button><button data-sector="energy">Energy</button>
<select id="dataset"></select><input id="provider" placeholder="provider"><input id="query" placeholder="product / plan">
<a id="jsonLink">JSON</a><a id="xlsxLink">XLSX</a>
</section>
<section class="stats" id="stats"></section>
<section class="chart"><canvas id="chart" width="1100" height="260"></canvas></section>
<section class="tableWrap"><table id="table"></table></section>
</main>
<script src="/assets/app.js"></script>
</body>
</html>
"""

CSS = """
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#111;background:#f6f7f8}
body{margin:0}header{height:48px;background:#fff;border-bottom:1px solid #d7dce0;display:flex;align-items:center;gap:16px;padding:0 18px}
header strong{font-size:18px}header span{color:#5f6872}select,input,button,a{height:32px;border:1px solid #cbd3da;background:#fff;color:#111;padding:0 10px;border-radius:4px;font-size:13px}
button.active{background:#111;color:#fff;border-color:#111}a{display:inline-flex;align-items:center;text-decoration:none}
main{padding:14px 18px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px}
.stat{background:#fff;border:1px solid #dfe4e8;border-radius:6px;padding:8px}.stat b{display:block;font-size:20px}.stat span{font-size:12px;color:#65707a}
.chart,.tableWrap{background:#fff;border:1px solid #dfe4e8;border-radius:6px;margin-bottom:10px;overflow:auto}.chart{padding:8px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #e6eaee;padding:6px 8px;white-space:nowrap;text-align:left}
th{position:sticky;top:0;background:#f1f3f5;z-index:1}td.num{text-align:right;font-variant-numeric:tabular-nums}
"""

JS = """
let state={sector:'banks',manifest:null,banks:null,energy:null};
const $=id=>document.getElementById(id);
async function getJson(url){const r=await fetch(url,{cache:'force-cache'});if(!r.ok)throw new Error(url);return r.json();}
async function init(){state.manifest=await getJson('/api/latest');$('date').innerHTML=`<option>${state.manifest.run_date}</option>`;await loadSector('banks');bind();}
function bind(){document.querySelectorAll('[data-sector]').forEach(b=>b.onclick=()=>loadSector(b.dataset.sector));['dataset','provider','query'].forEach(id=>$(id).oninput=render);}
async function loadSector(sector){state.sector=sector;document.querySelectorAll('[data-sector]').forEach(b=>b.classList.toggle('active',b.dataset.sector===sector));if(!state[sector])state[sector]=await getJson(`/api/${sector}?date=${state.manifest.run_date}`);setupFilters();render();}
function setupFilters(){const ds=$('dataset');if(state.sector==='banks'){let vals=[...new Set(state.banks.products.map(x=>x.dataset).filter(Boolean))];ds.innerHTML='<option value="">All datasets</option>'+vals.map(v=>`<option>${v}</option>`).join('');ds.style.display='inline-block';}else{ds.innerHTML='';ds.style.display='none';}}
function filteredRows(){const q=$('query').value.toLowerCase(),p=$('provider').value.toLowerCase(),d=$('dataset').value;if(state.sector==='banks'){return state.banks.rates.filter(r=>(!d||r.dataset===d)&&(!p||r.provider.toLowerCase().includes(p))&&(!q||(r.product_name||'').toLowerCase().includes(q))).slice(0,1500);}return state.energy.plans.filter(r=>(!p||r.provider.toLowerCase().includes(p))&&(!q||(r.plan_name||'').toLowerCase().includes(q))).slice(0,1500);}
function render(){const rows=filteredRows();links();stats(rows);draw(rows);table(rows);}
function links(){const d=state.manifest.run_date,s=state.sector;$('jsonLink').href=`/exports/${s}-${d}.json`;$('xlsxLink').href=`/exports/${s}-${d}.xlsx`;}
function stats(rows){const c=state[state.sector].counts;let cards=Object.entries(c).map(([k,v])=>`<div class=stat><b>${v}</b><span>${k}</span></div>`).join('');cards+=`<div class=stat><b>${rows.length}</b><span>visible rows</span></div>`;$('stats').innerHTML=cards;}
function draw(rows){const c=$('chart'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);if(state.sector!=='banks'){ctx.fillStyle='#222';ctx.fillText('Energy plan detail is shown in the table.',20,30);return;}let data=rows.map(r=>({name:r.provider+' - '+r.product_name,rate:parseFloat(r.rate)*100})).filter(x=>Number.isFinite(x.rate)).sort((a,b)=>b.rate-a.rate).slice(0,40);let max=Math.max(...data.map(x=>x.rate),1);ctx.font='11px Arial';data.forEach((x,i)=>{let y=18+i*6,w=(c.width-260)*x.rate/max;ctx.fillStyle='#2f6f73';ctx.fillRect(240,y,w,4);ctx.fillStyle='#222';ctx.fillText(x.name.slice(0,34),8,y+5);ctx.fillText(x.rate.toFixed(2)+'%',245+w,y+5);});}
function table(rows){let keys=state.sector==='banks'?['dataset','provider','product_name','rate','comparison_rate','rate_type','application_type','repayment_type','loan_purpose','term','last_updated']:['provider','plan_name','fuel_type','last_updated','description'];let head='<tr>'+keys.map(k=>`<th>${k}</th>`).join('')+'</tr>';let body=rows.map(r=>'<tr>'+keys.map(k=>`<td class="${k.includes('rate')?'num':''}">${esc(r[k]||'')}</td>`).join('')+'</tr>').join('');$('table').innerHTML=head+body;}
function esc(v){return String(v).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
init().catch(e=>{document.body.innerHTML='<pre>'+e.stack+'</pre>';});
"""


class CachedFiles:
    def __init__(self, exports_root: Path):
        self.exports_root = exports_root.resolve()
        self.memory: Dict[Path, Tuple[float, bytes]] = {}

    def read(self, path: Path) -> bytes:
        resolved = path.resolve()
        if self.exports_root not in resolved.parents and resolved != self.exports_root:
            raise FileNotFoundError(path)
        stat = resolved.stat()
        cached = self.memory.get(resolved)
        if cached and cached[0] == stat.st_mtime:
            return cached[1]
        data = resolved.read_bytes()
        self.memory[resolved] = (stat.st_mtime, data)
        return data


class LocalDashboardServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_handler(exports_root: Path):
    cache = CachedFiles(exports_root)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            try:
                body, ctype = self.route(parsed.path, parse_qs(parsed.query), cache)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "public, max-age=300")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except FileNotFoundError:
                self.send_error(HTTPStatus.NOT_FOUND)

        def log_message(self, fmt: str, *args: object) -> None:
            print(fmt % args)

        def route(self, path: str, query: Dict[str, list[str]], files: CachedFiles) -> Tuple[bytes, str]:
            if path == "/":
                return HTML.encode("utf-8"), "text/html; charset=utf-8"
            if path == "/assets/app.css":
                return CSS.encode("utf-8"), "text/css; charset=utf-8"
            if path == "/assets/app.js":
                return JS.encode("utf-8"), "application/javascript; charset=utf-8"
            if path == "/api/latest":
                return files.read(exports_root / "dashboard-cache" / "latest.json"), "application/json"
            if path in ("/api/banks", "/api/energy"):
                date = query.get("date", [""])[0]
                name = path.rsplit("/", 1)[1] + ".json"
                return files.read(exports_root / "dashboard-cache" / date / name), "application/json"
            if path.startswith("/exports/"):
                target = exports_root / path.removeprefix("/exports/")
                return files.read(target), mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            raise FileNotFoundError(path)

    return Handler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve local CDR dashboard from generated cache.")
    parser.add_argument("--exports", type=Path, required=True, help="Export folder containing dashboard-cache/")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default="auto", help="Port number or 'auto' (default: auto from 8800)")
    parser.add_argument("--port-file", type=Path, help="Optional JSON file to write the selected dashboard URL to.")
    return parser.parse_args()


def dashboard_url(host: str, port: int) -> str:
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    return f"http://{display_host}:{port}/"


def create_server(host: str, value: str, handler):
    if value != "auto":
        port = int(value)
        return LocalDashboardServer((host, port), handler), port
    port = 8800
    while True:
        try:
            return LocalDashboardServer((host, port), handler), port
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, errno.EACCES, 10048):
                raise
            port += 1


def main() -> int:
    args = parse_args()
    server, port = create_server(args.host, str(args.port), make_handler(args.exports))
    url = dashboard_url(args.host, port)
    if args.port_file:
        args.port_file.write_text(json.dumps({"host": args.host, "port": port, "url": url}), encoding="utf-8")
    print(f"Local CDR dashboard: {url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
