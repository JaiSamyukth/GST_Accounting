# Dev Caters GST Accounting

GST accounting for Dev Caters, Trichy: record sales and purchase bills, check input tax credit against GSTR-2B, and prepare GSTR-1 and GSTR-3B every month. Nothing else (no orders, menus, stock or payroll).

The screens look like the Dev Caters duplicate order book (navy print, white original, yellow carbon copy), so the people who fill that book already know where things go. A guided tour runs on first sign-in, and **Guide & help** has how-tos and a plain-English GST glossary. Any underlined GST word in the app explains itself when tapped.

## What it does

| Module | Where |
|---|---|
| Business and GST settings (GSTIN check, PAN, state, monthly or quarterly filing, rates, HSN/SAC) | Settings |
| Sales: invoices, credit and debit notes, B2B / B2C / B2C large / export classification, amendments of filed bills | Sales |
| Purchases: supplier bills, categories, per-line ITC eligibility with reasons | Purchases |
| GST engine: CGST+SGST or IGST, inclusive or exclusive prices, discounts, nil / exempt / non-GST / zero rated, round off | `backend/app/services/gst.py` |
| ITC: GSTR-2B import and matching, missing and mismatched bills, reversals and reclaims (rules 37, 42, 43, section 17(5)) | Returns → Match with GSTR-2B |
| GSTR-1: b2b, b2cl, b2cs, exp, cdnr, cdnur, nil, HSN (B2B and B2C), doc issue, amendments; JSON, Excel, PDF, CSV | Returns → GSTR-1 |
| GSTR-3B: 3.1, 3.2, 4A-4D, 5, 6.1 with legal ITC set-off order; GSTR-1 vs 3B comparison | Returns → GSTR-3B |
| Monthly return record: approval, payment, ARN, filing date, acknowledgements, period lock | Returns → File and save ARN |
| 12 reports with FY / month / quarter / date filters; PDF, Excel, CSV, JSON | Reports |
| Users: owner and accountant roles, sessions, login history, password reset links, audit log | Settings |
| Import: CSV, XLS, XLSX, JSON, ZIP; templates, column mapping, validation, preview, error report, history, undo | Import from Excel |
| Documents: bill photos and PDFs linked to records | on each bill, and Documents |

### GST notes to confirm with the accountant
- Outdoor catering (SAC 996334) is set up at **5% without ITC**, the usual rate for standalone outdoor catering (Notification 11/2017-CT(Rate), entry 7). With the "5% without ITC" setting on, purchase GST is marked not claimable. Catering at specified premises is 18% with ITC. All rates are editable.
- B2C large limit is ₹1,00,000 (from August 2024), editable in Settings.
- Ineligible credit is shown in 4A and reversed in 4B(1), following Circular 170/02/2022.
- Export JSON follows the portal's key names (schema label shown on each return). Validate with the GST offline tool before upload; the portal changes formats.
- Direct filing through a GST Suvidha Provider (Level 2) is an adapter that stays off until a licensed provider is contracted (`backend/app/services/gsp.py`). Filing works through the portal with the downloaded files.

## Run it

Needs Python 3.11+, Node 20+, and PostgreSQL (Supabase works). SQLite is used if `DATABASE_URL` is not set, which is fine for trying it out.

```bash
cd backend && pip install -r requirements.txt
```

```bash
cd frontend && npm install && npm run build
```

```bash
cd backend && DATABASE_URL=postgresql+psycopg://user:pass@host:5432/db uvicorn app.main:app --port 8000
```

Open http://localhost:8000. The first visit asks for the owner's account. To try it with a month of sample data:

```bash
cd backend && python -m scripts.demo_data http://127.0.0.1:8000 owner@example.com a-long-password1
```

For frontend development, run `npm run dev` in `frontend/` (it proxies `/api` to port 8000) and set `CORS_ORIGINS=http://localhost:5173`.

### Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | SQLite in `backend/data/` | PostgreSQL URL for production (Supabase connection string with `postgresql+psycopg://`) |
| `STORAGE_BACKEND` | `local` | `supabase` to keep documents in Supabase Storage |
| `STORAGE_DIR` | `backend/data/files` | for local storage |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | | for Supabase Storage (bucket must exist, private) |
| `COOKIE_SECURE` | `false` | set `true` behind HTTPS |
| `SESSION_HOURS` | `12` | |
| `CORS_ORIGINS` | `http://localhost:5173` | comma separated |
| `GSP_PROVIDER` | | name of a contracted GSP; leaves Level 2 filing off when empty |

No credentials are in the code. Tables are created on first start.

### Backups and recovery
- Use the database host's automatic backups (Supabase daily backups / point-in-time recovery).
- The owner can also download a full JSON backup of every table from Settings → My account.
- Every financial change is in the audit log with before and after values. Filed periods are locked; unlocking needs the owner and a written reason.

## Tests

```bash
cd backend && python -m pytest -q
```

35 tests cover the GST engine, GSTIN checksum, periods, ITC set-off, GSTR-1/3B figures, amendments and locking, imports with errors and rollback, GSTR-2B matching, reports in every format, roles and sessions. They also pass against PostgreSQL (`DATABASE_URL=... python -m pytest`).

## Layout

```
backend/app/services   gst.py (engine) · returns.py (GSTR-1/3B) · recon.py (2B) · importers.py · reports.py · exporters.py
backend/app/api        REST routes (OpenAPI docs at /docs)
frontend/src/pages     one file per screen
frontend/DESIGN.md     concept, palette, type
docs/design.md         architecture and GST rules
```
