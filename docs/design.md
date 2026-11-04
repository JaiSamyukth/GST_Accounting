# Dev Caters GST Accounting: design

Scope is the SRS v1.0 (14 modules), GST accounting only. No orders, menus, inventory, payroll or CRM.

## Facts this design rests on

- Dev Caters keeps records on paper (the duplicate order book: white original, yellow carbon copy) and WhatsApp.
- They need monthly GST returns prepared (GSTR-1, GSTR-3B), exported for the accountant, ARN stored.
- Standalone outdoor catering (SAC 996334) is taxed at 5% **without ITC** (Notification 11/2017-CT(Rate), entry 7(iv), as read in 2026 advance rulings). Outdoor catering at "specified premises" is 18% with ITC.
  The app ships these as editable defaults, never as a single hard-coded rate. A business setting
  ("outward supplies at 5% without ITC") makes new purchase lines default to ineligible ITC with that reason.
  **Have the CA confirm rates for each period.**

## Architecture

```
frontend (React + Vite + TS)  --REST/JSON, httpOnly session cookie-->  backend (FastAPI)
                                                                         |  SQLAlchemy 2
                                                                         v
                                                          PostgreSQL (Supabase-compatible)
                                                          Storage: local disk or Supabase Storage
```

- Money is `Decimal`, stored as `NUMERIC(14,2)`. Rounding: half-up to paise per line tax component.
- All GST computation happens on the server (`app/services/gst.py`). The browser previews using the same API (`POST /api/gst/calculate`).
- Sessions: random token in an httpOnly, SameSite=Lax cookie, hashed in the `sessions` table. Mutations require the `X-Requested-With` header (CSRF guard). bcrypt password hashes.
- Every create/update/delete on financial records writes `audit_log` with before/after JSON. Records dated inside a **filed** period are locked; only the owner can unlock, and that is audited.
- Imports run in two steps: `preview` (parse, map, validate, no writes) then `commit` (single DB transaction). Each committed batch records the ids it created so it can be rolled back.

## GST rules implemented

- Intra-state (place of supply = business state): CGST + SGST, half each. Inter-state: IGST.
- Price mode: exclusive (taxable = qty x rate - discount) or inclusive (taxable = gross / (1 + rate)).
- Supply kinds per line: taxable, exempt, nil-rated, non-GST, zero-rated (export/SEZ).
- Invoice classes for GSTR-1: B2B (customer GSTIN), B2CL (inter-state, unregistered, invoice value above the B2CL limit, default ₹1,00,000, configurable), B2CS (rest), EXP. Credit/debit notes: CDNR (registered), CDNUR.
- ITC: eligible / ineligible (reason: section 17(5), 5%-without-ITC scheme, personal use, other). Reversals by type (Rule 42, Rule 43, Section 17(5), Rule 37 / others) per period.
- GSTR-2B reconciliation keys: supplier GSTIN + normalised invoice number; status matched / mismatch (amount or date) / missing in 2B / missing in books.
- GSTR-3B: 3.1(a)-(e), 4A(3) reverse charge, 4A(5) all other ITC, 4B(1)/(2) reversals, 4D ineligible, 5 exempt/nil/non-GST inward, 6.1 payment with set-off order (IGST credit to IGST then CGST then SGST; CGST credit to CGST then IGST; SGST credit to SGST then IGST).

## JSON schemas (versioned)

Export schemas live in `app/services/schemas_gst.py` with a `SCHEMA_VERSION`. GSTR-1 uses portal keys (`b2b`, `b2cl`, `b2cs`, `cdnr`, `cdnur`, `exp`, `nil`, `hsn` with `hsn_b2b`/`hsn_b2c`, `doc_issue`). Validate exports in the GST offline tool before upload; the portal changes formats.

## GST portal integration

Level 1 (prepare + export + store ARN) is complete. Level 2 (direct filing via a GSP) is an adapter
interface (`app/services/gsp.py`) that reports "not configured" until a licensed GSP's credentials are
supplied. Nothing pretends to file.
