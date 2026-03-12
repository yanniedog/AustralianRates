# Exhaustive User Interaction Flowchart

This document describes the implemented user interaction sequences on https://www.australianrates.com: pages, navigation, modals, and controls. Each diagram shows what opens what and what the user can do next.

---

## 1. Site entry and page-to-page navigation

```mermaid
flowchart TB
    subgraph Entry["Entry points"]
        E1["/ (Home Loans)"]
        E2["/savings/"]
        E3["/term-deposits/"]
        E4["/about/"]
        E5["/contact/"]
        E6["/privacy/"]
        E7["/terms/"]
        E8["/admin/ or /admin/index.html (Login)"]
    end

    subgraph Public["Public market pages"]
        P1["/ (Home Loans)"]
        P2["/savings/"]
        P3["/term-deposits/"]
        PT["Shared public tree\n(sections + About/Contact/Privacy/Terms)"]
    end

    subgraph Legal["Legal / reference pages"]
        L1["/about/"]
        L2["/contact/"]
        L3["/privacy/"]
        L4["/terms/"]
        LD["Header menu drawer\n(public tree on legal pages)"]
    end

    subgraph Admin["Admin"]
        A0["/admin/ or /admin/index.html (Login)"]
        A1["dashboard.html"]
        A2["status.html"]
        A3["database.html"]
        A4["clear.html"]
        A5["config.html"]
        A6["runs.html"]
        A7["logs.html"]
        AS["Shared admin sidebar\n(all admin pages except login)"]
        LO["Log out"]
    end

    E1 --> P1
    E2 --> P2
    E3 --> P3
    E4 --> L1
    E5 --> L2
    E6 --> L3
    E7 --> L4
    E8 --> A0

    P1 --> PT
    P2 --> PT
    P3 --> PT
    PT --> P1
    PT --> P2
    PT --> P3
    PT --> L1
    PT --> L2
    PT --> L3
    PT --> L4

    L1 --> LD
    L2 --> LD
    L3 --> LD
    L4 --> LD
    LD --> P1
    LD --> P2
    LD --> P3
    LD --> L1
    LD --> L2
    LD --> L3
    LD --> L4

    A0 -->|"Valid token"| A1
    A0 -->|"Brand click"| P1
    A1 --> AS
    A2 --> AS
    A3 --> AS
    A4 --> AS
    A5 --> AS
    A6 --> AS
    A7 --> AS
    AS --> A1
    AS --> A2
    AS --> A3
    AS --> A4
    AS --> A5
    AS --> A6
    AS --> A7
    AS -->|"Public"| P1
    A1 --> LO
    LO --> A0
```

Public pages render a left nav tree with market sections plus About, Contact, Privacy, and Terms. Legal pages expose the same tree through the header menu drawer. All non-login admin pages render a shared sidebar with Dashboard, Status, Database, Clear, Config, Runs, Logs, and Public links; several pages also keep a page-local "Back to dashboard" link.

---

## 2. Global header actions

```mermaid
flowchart LR
    subgraph Header["Shared header controls"]
        B1["Brand click"]
        B2["Theme toggle"]
        B3["Help button"]
        B4["Refresh button"]
        B5["GitHub link"]
        B6["Menu toggle"]
    end

    B1 --> PageHome["/ (Home)"]
    B2 --> Theme["Toggle light/dark"]
    B3 --> HelpSheet["Open Help sheet"]
    B4 --> Refresh["Clear cookies/storage/cache + reload"]
    B5 --> ExternalGit["GitHub (external)"]
    B6 --> LegalMenu["Legal pages: open Menu drawer"]
    B6 --> NoDrawer["Public/admin pages: no visible drawer is rendered"]
```

On mobile-host public/legal pages, an extra `DESK` / `MOB` switch is inserted into the header and a `Desktop site` / `Mobile site` link is added in the footer.

---

## 3. Public market page: anchored sections and tabbed panes

On `/`, `/savings/`, and `/term-deposits/` there are two different hash behaviors:

- `#chart`, `#ladder`, `#export`, and `#market-notes` scroll to anchored sections on the same page.
- `#table`, `#pivot`, `#history`, and `#changes` activate the tabbed bottom workspace. The active tab is also mirrored into the `?tab=` query string.

```mermaid
flowchart TB
    subgraph Anchors["Anchored sections"]
        A1["#chart"]
        A2["#ladder"]
        A3["#export"]
        A4["#market-notes"]
    end

    subgraph Tabs["Tabbed workspace"]
        T1["#table -> Table tab"]
        T2["#pivot -> Pivot tab"]
        T3["#history -> History tab"]
        T4["#changes -> Changes tab"]
    end

    A1 --> Scroll["Scroll to same-page section"]
    A2 --> Scroll
    A3 --> Scroll
    A4 --> Notes["Scroll to Notes details element\n(hash does not force it open)"]

    T1 --> Switch["Activate bottom workspace tab"]
    T2 --> Switch
    T3 --> Switch
    T4 --> Switch
```

Charts, Leaders, Download, and Notes are reached from the left nav tree. Only Table, Pivot, History, and Changes are also switchable via the in-page tab buttons.

---

## 4. Modals and overlays: open -> actions -> outcome

```mermaid
flowchart TB
    subgraph Triggers["What opens it"]
        T1["#site-help-btn (header)"]
        T2["#site-menu-toggle (legal pages)"]
        T3["#footer-log-link"]
        T4["#table-settings-btn (Table pane)"]
        T5["Add row (admin/database)"]
        T6["Edit selected (admin/database)"]
    end

    subgraph Modals["Modal / overlay"]
        M1["Help sheet\n#site-help-sheet"]
        M2["Menu drawer\n#site-menu-drawer (legal pages)"]
        M3["Footer log popup\n#footer-log-popup"]
        M4["Table settings popover\n#table-settings-popover"]
        M5["Row modal\n#row-modal (admin)"]
    end

    T1 --> M1
    T2 --> M2
    T3 --> M3
    T4 --> M4
    T5 --> M5
    T6 --> M5

    M1 --> C1["Close help / backdrop / Escape"]
    C1 --> Page["Same page"]

    M2 --> C2A["Click section/link"]
    M2 --> C2B["Close menu / backdrop / Escape"]
    C2A --> Navigate["Navigate to page or hash"]
    C2B --> Page

    M3 --> C3A["Download client log"]
    M3 --> C3B["Toggle link again / click outside"]
    C3A --> Download["Download file, popup hidden"]
    C3B --> Page

    M4 --> C4A["Change settings (show removed, move columns, columns)"]
    M4 --> C4B["Click outside / Escape"]
    C4A --> TableUpdate["Table/pane updates"]
    C4B --> Page

    M5 --> C5A["Save"]
    M5 --> C5B["Cancel / backdrop"]
    C5A --> RefreshTable["Close modal, refresh table"]
    C5B --> Page
```

The header menu button is present across the shared frame, but the drawer itself is only rendered on legal pages.

---

## 5. Public market: filters and workspace actions

```mermaid
flowchart TB
    subgraph Filters["Filter bar"]
        F1["Apply filters (#apply-filters)"]
        F2["Reset filters (#reset-filters)"]
        F3["Copy link (#workspace-copy-link)"]
        F4["Filter bank search (#filter-bank-search)"]
        F5["Filter All (#filter-bank-clear)"]
        F6["Active filter chips (click chip)"]
        F7["More filters (details expand/collapse)"]
    end

    F1 --> URL["URL sync, refresh table/hero/charts/summary"]
    F2 --> Reset["Reset to defaults, re-apply"]
    F3 --> Clipboard["Copy URL to clipboard"]
    F4 --> BankList["Filter bank list"]
    F5 --> ClearBank["Clear bank filter"]
    F6 --> RemoveOne["Remove that filter"]
    F7 --> Expand["Show/hide advanced filters + interval"]
```

---

## 6. Public market: Table pane

```mermaid
flowchart TB
    TS["Table settings (#table-settings-btn)"]
    TS --> POP["Table settings popover opens"]
    POP --> P1["Show removed rates toggle"]
    POP --> P2["Move columns toggle"]
    POP --> P3["Column visibility checkboxes"]
    POP --> P4["Click outside / Escape"]
    P1 --> Reload1["Reload table"]
    P2 --> Reinit["Re-init table"]
    P3 --> Reload2["Update columns"]
    P4 --> Close["Close popover"]
```

---

## 7. Public market: Export (Download pane)

```mermaid
flowchart TB
    DF["Download format (#download-format)"]
    DF --> Choose["Choose CSV / Excel / JSON"]
    Choose --> Trigger["Trigger table download (on format change)"]
```

The main site has no separate "Download CSV" button; changing the format select triggers the download. Code supports an optional `#download-csv` button if present in alternate layouts.

---

## 8. Public market: Chart pane

```mermaid
flowchart TB
    V["Chart view chips\n(Leaders, Movement, Compare, Distribution)"]
    Y["Y axis (#chart-y)"]
    X["X axis (#chart-x)"]
    G["Group by (#chart-group)"]
    D["Density (#chart-series-limit)"]
    T["Chart type (#chart-type)"]
    U["Update chart (#draw-chart)"]
    V --> RenderCached["If chart data is already loaded:\nrerender from cache"]
    Y --> RenderCached
    X --> RenderCached
    G --> RenderCached
    D --> RenderCached
    T --> RenderCached
    U --> RenderFresh["Fetch chart data + render chart"]
```

Chart summary and chart-point `Open` links go to `row.product_url` when present. The table's `URLs` column separately exposes `Product`, `Source`, and `Wayback` links when present.

---

## 9. Public market: Pivot pane

```mermaid
flowchart TB
    LP["Load pivot (#load-pivot)"]
    LP --> Load["Load pivot data"]
```

---

## 10. Public market: Ladder (Leaders) pane

```mermaid
flowchart TB
    LS["Ladder search (#ladder-search)"]
    LS --> Filter["Filter quick-compare cards by bank/product"]
```

---

## 11. Public market: Notes and rate changes (expand/collapse)

```mermaid
flowchart TB
    N["Market notes (#market-notes details)"]
    R["Rate change details (#rate-change-details details)"]
    N --> ExpandN["Expand/collapse methodology"]
    R --> ExpandR["Expand/collapse recent changes"]
```

---

## 12. Footer (all pages with frame)

```mermaid
flowchart TB
    FT["Footer Technical (details)"]
    FL["Footer log link (#footer-log-link)"]
    FL --> LogPopup["Log popup opens"]
    LogPopup --> DL["Download client log"]
    DL --> Hide["Popup hidden"]
    FT --> ExpandFooter["Expand/collapse commit + log"]
```

Footer links: About, Contact, Privacy, Terms (same as nav). On mobile-host public/legal pages, the host switch appears in both the header (`DESK` / `MOB`) and the footer (`Desktop site` / `Mobile site`).

---

## 13. Admin login

```mermaid
flowchart TB
    Login["Submit #login-form"]
    Login --> Validate["Validate token (fetch)"]
    Validate -->|Success| Dash["Redirect to dashboard.html"]
    Validate -->|Failure| Error["Show error in #login-error"]
```

---

## 14. Admin dashboard

```mermaid
flowchart TB
    D["dashboard.html"]
    D --> Card1["Status card"]
    D --> Card2["Database card"]
    D --> Card3["Clear card"]
    D --> Card4["Config card"]
    D --> Card5["Runs card"]
    D --> Card6["Logs card"]
    D --> Card7["Public site"]
    D --> Logout["Log out"]
    Card1 --> A2["status.html"]
    Card2 --> A3["database.html"]
    Card3 --> A4["clear.html"]
    Card4 --> A5["config.html"]
    Card5 --> A6["runs.html"]
    Card6 --> A7["logs.html"]
    Card7 --> P1["/ (home)"]
    Logout --> A0["/admin/"]
```

All non-login admin pages also expose the shared admin sidebar, so navigation is not limited to dashboard cards.

---

## 15. Admin database page

```mermaid
flowchart TB
    TSel["Table select (#table-select)"]
    Add["Add row"]
    Edit["Edit selected"]
    Del["Delete selected"]
    Ref["Refresh"]
    TSel --> Load["Load table"]
    Add --> RowModal["Row modal (add mode)"]
    Edit --> RowModal2["Row modal (edit mode)"]
    Del --> ConfirmDel["Confirm then DELETE"]
    Ref --> Reload["Reload table"]
    RowModal --> Save["Save"]
    RowModal --> Cancel["Cancel / backdrop"]
    Save --> CloseRefresh["Close modal, refresh table"]
    Cancel --> Close["Close modal"]
```

---

## 16. Admin clear page

```mermaid
flowchart TB
    PT["Product type"]
    Scope["Scope (individual / group / multiselect / entire)"]
    Clear["Clear data"]
    PT --> ScopeOptions["Switch scope options"]
    Scope --> ShowScope["Show selected scope UI"]
    Clear --> ConfirmClear["Confirm then POST clear"]
```

---

## 17. Admin config page

```mermaid
flowchart TB
    RI["Rate check interval"]
    SaveRI["Save (#rate-check-save-btn)"]
    AddKV["Add (key/value)"]
    SaveRI --> SaveInterval["Save interval"]
    AddKV --> AddRow["Add app config row"]
    Table["Per-row Save/Delete in config table"]
    Table --> Update["Update config"]
    Table --> Delete["Delete config"]
```

---

## 18. Admin runs page

```mermaid
flowchart TB
    subgraph Triggers["Trigger actions"]
        T1["Trigger daily run"]
        T2["Trigger backfill"]
        T3["Trigger historical pull (date)"]
        T4["Refresh now"]
        T5["Refresh backlog"]
        T6["Dry-run reconcile"]
        T7["Run reconcile"]
        T8["Dry-run lineage repair"]
        T9["Run lineage repair (lookback)"]
    end
    T1 --> Run1["Run job"]
    T2 --> Run2["Run job"]
    T3 --> Run3["Run job"]
    T4 --> Run4["Refresh"]
    T5 --> Run5["Backlog"]
    T6 --> Run6["Dry run"]
    T7 --> Run7["Reconcile"]
    T8 --> Run8["Dry run"]
    T9 --> Run9["Repair"]
    subgraph Details["Expand/collapse"]
        D1["Latest reconcile or repair payload"]
        D2["Show raw realtime payload"]
    end
```

---

## 19. Admin status page

```mermaid
flowchart TB
    RC["Run check now"]
    CDR["Run CDR audit"]
    Ref["Refresh"]
    Copy["Copy diagnose command"]
    Pay["Payload viewer (.js-payload-link)"]
    RC --> RunCheck["Run check"]
    CDR --> RunCDR["Run CDR audit"]
    Ref --> Reload["Reload status + CDR + probe payloads"]
    Copy --> Clipboard["Copy npm run diagnose:api"]
    Pay --> LoadPayload["Load payload by data-fetch-event-id"]
```

Status page also has quick links: Logs -> `logs.html`, Runs -> `runs.html`, Configuration -> `config.html`.

---

## 20. Admin logs page

```mermaid
flowchart TB
    DS["Download system log (JSONL/text)"]
    WS["Wipe system log"]
    DC["Download client log"]
    WC["Wipe client log"]
    DS --> Download["Download"]
    WS --> ConfirmWipe["Confirm then wipe"]
    DC --> DownloadClient["Download client log"]
    WC --> WipeClient["Wipe client log"]
```

---

## 21. External / out-of-site

| Action | Result |
|--------|--------|
| GitHub (header / contact) | https://github.com/yanniedog/AustralianRates |
| Operator (privacy, contact, about, terms) | https://github.com/yanniedog |
| Mailto (privacy, contact, about, terms) | support@australianrates.com |
| Chart summary / chart-point `Open` links | `row.product_url` (lender page, new tab when present) |
| Table `URLs` column | `row.product_url`, `row.source_url`, and Wayback lookup when present |
| Noscript API links | /api/{section}-rates/... (new tab) |
| Footer deploy link | GitHub commit URL when available |

---

## 22. Tooltips and help

- Elements with `data-help`: hover/focus show tooltip; long-press on touch opens the Help sheet.
- Escape closes the tooltip, Help sheet, and legal-page menu drawer.

---

## Summary

- **Pages:** 3 public market (/, /savings/, /term-deposits/), 4 legal (about, contact, privacy, terms), 1 admin login, 7 admin pages (dashboard, status, database, clear, config, runs, logs).
- **Public hash behavior:** `#chart`, `#ladder`, `#export`, and `#market-notes` are anchored sections; `#table`, `#pivot`, `#history`, and `#changes` switch the tabbed bottom workspace.
- **Modals/overlays:** Help sheet (header), Menu drawer (legal pages only), Footer log popup, Table settings popover (Table pane), Row modal (admin database). Each has a concrete trigger and close/next action.
- **Admin:** Login -> dashboard -> shared sidebar across all 7 admin pages; dashboard also has `Log out`. Database has row add/edit modal; clear has scope + confirm; config has interval + key/value; runs has trigger buttons plus backlog/repair actions; logs has download/wipe.
- **Global:** Header (brand, theme, help, refresh, GitHub, menu), footer (legal links, technical details, log popup), and on mobile-host public/legal pages the DESK/MOB host switch in both header and footer.

Use this document together with the Mermaid diagrams to trace any user path from entry through clicks to the next page, pane, or overlay.
