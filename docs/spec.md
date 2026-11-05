# GST-Invoice — design specification

Status: awaiting review. Date: 5 November 2026.

Rebuild of `D:\Projects\GST_Accounting` (FastAPI + React/Vite + SQLite/Postgres) as a single
Next.js application on Vercel with Neon Postgres and Neon Object Storage. Behaviour is preserved;
the stack, where attachments live and the visual treatment are new.

---

## 1. Purpose

Dev Caters (outdoor catering, Trichy) keeps sales and purchase records on paper and WhatsApp.
They need to close each month's GST: prepare GSTR-1 and GSTR-3B, claim input tax credit against
GSTR-2B, give the accountant files, and store the ARN.

Success is: a non-technical owner can enter a bill and a sale, see what tax is due, print the
invoice, and produce the two returns for a month without help.

## 2. Scope

Full feature parity with the old application, except where section 4 says otherwise.

| Area | Included |
|---|---|
| Business settings | Legal/trade name, GSTIN, PAN, address, state, jurisdiction, registration type, filing frequency, FY start, invoice prefix, B2CL limit, no-ITC scheme, round-off default, price mode |
| Masters | Tax rates, HSN/SAC, customers, suppliers |
| Sales | Invoices, credit notes, debit notes, amendments, export flags, place of supply, reverse charge |
| Purchases | Supplier bills, notes, categories, per-line ITC eligibility and reason, ITC period |
| GST engine | Intra/inter state, inclusive/exclusive, discount, cess, nil/exempt/non-GST/zero-rated, round off |
| Returns | GSTR-1 and GSTR-3B figures, JSON payloads, comparison, approval, filing/ARN, payment, lock/unlock, snapshot |
| ITC | GSTR-2B entries, matching, mismatches, missing rows, adjustments/reversals/reclaims |
| Reports | All 12 reports with FY/month/quarter/date filters |
| Export | PDF, XLSX, CSV, JSON for invoices, notes, returns and reports |
| Attachments | Upload bill photos and supplier PDFs against a sale, purchase or return; list, download and delete them |
| Import | CSV/XLSX for sales, notes, purchases, customers, suppliers, HSN, payments; mapping, preview, validation, error report, commit, undo |
| Access | Owner/accountant roles, sessions, login history, password reset links, audit log |
| Backup | Owner downloads every table as JSON in a ZIP |

## 3. Non-goals

- No orders, menu, stock, payroll or CRM.
- No direct filing through a GSP. Level 1 only: prepare, export, upload manually, store ARN.
- No email sending. Reset links are displayed for the owner to pass on.
- No multi-tenant organisations. One business per deployment.
- No offline mode, PWA, WhatsApp integration, or mobile app.

## 4. Deliberate changes from the old app

| Change | Reason |
|---|---|
| One Next.js project replaces FastAPI + Vite | Deploy to Vercel as one project; no separate backend host |
| Neon Postgres only | Vercel-native; no SQLite fallback |
| **Uploads go to Neon Object Storage.** Private `gst-documents` bucket, no local disk | Invoices and reports stay generated on demand; bill photos and supplier PDFs need somewhere durable that survives a Vercel redeploy. Files are streamed through the app so the bucket stays private |
| Plain UI: no order-book theme, webfonts, tour, guide widget, glossary, animation | Explicit request: "very very simple" |
| Integer paise + basis points instead of Python `Decimal` | Exact money arithmetic in JavaScript without a decimal dependency |
| Zod validation at every boundary | Replaces Pydantic |
| Vitest + PGlite replaces pytest | In-process Postgres for integration tests; no external DB needed |

The old `GST_Accounting` folder is left untouched.

## 5. Architecture

```
Browser (React 19 client components, plain CSS)
   |  fetch, JSON, httpOnly session cookie
   v
Next.js on Vercel
   ├── app/ pages ............ server components for shells, client components for forms
   ├── app/api/* route handlers (Node.js runtime)
   ├── lib/* domain logic ..... framework-free, unit tested
   ├── lib/storage.ts ........ S3 client for Neon Object Storage
   └── db/* Drizzle schema + client
           |                          |
           v                          v
   Neon Postgres (pooled)      Neon Object Storage (gst-documents, private)
```

- Runtime: Node.js for all routes (PDFKit, ExcelJS, `postgres` and the S3 client need Node).
- No edge runtime.
- No client-side GST truth: the editor calls `POST /api/gst/calculate` and renders the response.
- The browser never talks to the bucket directly. Uploads and downloads pass through
  `/api/documents`; the app checks the session first, then streams the object.
- Uploads are capped at 10 MB and limited to PDF, JPEG and PNG.

## 6. Money and rates

- **Money:** integer paise, `bigint` in Postgres, `number` in TypeScript.
  ₹1,234.56 → `123456`. Valid range is ±₹10 crore per value, well inside
  `Number.MAX_SAFE_INTEGER`.
- **Rates:** integer basis points (bp). 5% → `500`, 0.25% → `25`, 18% → `1800`.
- **Rounding:** half-up to the paisa *per line, per tax component*, exactly as the old engine.
- **Inclusive price:** taxable = round_half_up(net × 10000 / (10000 + rate_bp + cess_bp)),
  then absorb the residual paise into taxable value so the line total equals the amount charged.
- **Storage:** Drizzle `bigint({ mode: "number" })`. No `numeric` money columns.
- **Display:** `formatINR(paise)` produces Indian grouping (`1,23,456.00`).

## 7. Data model

All tables have `created_at`/`updated_at` where the old model did. IDs are `bigserial`.

| Table | Key columns |
|---|---|
| `users` | email unique, name, role (`owner`/`accountant`), password_hash, is_active, must_change_password |
| `sessions` | token_hash unique, user_id, expires_at, last_seen, ip, user_agent, revoked |
| `login_history` | user_id nullable, email, success, event, ip, user_agent, at |
| `password_resets` | user_id, token_hash unique, expires_at, used |
| `audit_log` | at, user_id, user_email, action, entity_type, entity_id, summary, before jsonb, after jsonb |
| `business` | singleton id=1, names, gstin, pan, address, state_code, jurisdiction, registration_type, filing_frequency, fy_start_year, contact, invoice_prefix, b2cl_limit, no_itc_scheme, round_off, default_price_mode |
| `tax_rates` | rate_bp, label, active |
| `hsn_codes` | code unique, description, is_service, default_rate_bp, supply_kind, uqc, itc_allowed, notes, active |
| `parties` | kind (`customer`/`supplier`), name, gstin, address, state_code, phone, email, active; unique (kind, name, gstin) |
| `sales_docs` | doc_type, number, date, party fields, place_of_supply, reverse_charge, price_mode, totals, round_off, notes, status, original_number/date, note_reason, is_export, export_with_igst, section, amends_id, amended_by_id, amend_period, order_ref, import_batch_id; unique (doc_type, number) |
| `sales_lines` | doc_id, position, description, hsn_sac, qty, unit, unit_price, discount, gst_rate_bp, cess_rate_bp, supply_kind, taxable_value, cgst, sgst, igst, cess, total |
| `purchases` | same document fields plus supplier fields, category, itc_period, recon_status; unique (supplier_gstin, supplier_name, number, doc_type) |
| `purchase_lines` | line fields plus itc_eligible, itc_reason |
| `itc_adjustments` | period, kind (`reversal`/`reclaim`), rule, igst/cgst/sgst/cess, note |
| `gstr2b_entries` | period, supplier_gstin, supplier_name, doc_type, number, date, taxable_value, taxes, itc_available, reverse_charge |
| `return_periods` | period unique, fy, gstr1/gstr3b status, ARNs and filed dates, approved_by/at, figures, snapshot jsonb, paid amounts, interest, late_fee, challan_ref, paid_on, locked, notes |
| `import_batches` | kind, filename, schema_version, status, row counts, mapping jsonb, errors jsonb, created_ids jsonb, created_by, rolled_back_at |
| `documents` | entity_type (`sale`/`purchase`/`return`/`party`), entity_id, kind (`bill_photo`/`supplier_pdf`/`acknowledgement`/`other`), filename, mime_type, size_bytes, object_key unique, checksum, uploaded_by, created_at |

`qty` is stored as `numeric(14,3)` (fractional quantities are real, e.g. 2.5 kg).
`unit_price` is `numeric(14,4)` (rate per unit). Both are converted to paise inside the engine
with documented rounding.

Indexes: dates, periods, doc numbers, party GSTIN, audit time, session token,
`documents (entity_type, entity_id)`, `documents object_key`.

Object keys follow `{entity_type}/{entity_id}/{uuid}.{ext}`. The bucket is private; no row stores a
public URL. Deleting a document row deletes the object, and the reverse never happens silently.

## 8. GST rules (must match the old engine)

- Intra-state: CGST and SGST, each half the rate. Inter-state or export: IGST.
- Supply kinds: `taxable`, `exempt`, `nil`, `non_gst`, `zero_rated`. Non-taxable kinds force rate 0.
- Exports: taxable lines become `zero_rated`; rate 0 unless "export with IGST" is set.
- GSTR-1 sections: `b2b` (registered), `b2cl` (unregistered, inter-state, invoice value above the
  limit, default ₹1,00,000), `b2cs`, `exp`, `cdnr`, `cdnur`, amendments `b2ba`/`b2cla`/`cdnra`.
- B2CS rows are grouped by supply type, place of supply and rate; signed for credit notes.
- HSN summary split B2B/B2C, grouped by HSN + rate + UQC, signed.
- Nil/exempt/non-GST table split inter/intra × B2B/B2C.
- GSTR-3B: 3.1(a)–(e), 3.2 unregistered inter-state, 4A(3) RCM ITC, 4A(5) other ITC,
  4B(1) reversals (rule 38/42/43/17(5)), 4B(2) other reversals, 4C net, 4D(1) reclaimed,
  5 inward exempt/nil/non-GST, 6.1 payment.
- ITC set-off order: IGST → IGST, CGST, SGST; CGST → CGST, IGST; SGST → SGST, IGST; cess → cess.
  RCM liability is paid in cash.
- Ineligible ITC appears in 4A(5) and is reversed in 4B(1) (Circular 170/02/2022).
- When GSTR-2B is imported and a bill is `missing_in_2b`, its ITC is deferred (not claimed),
  listed for the user.
- Amendments report full revised values in GSTR-1 and only the difference in GSTR-3B.
- Period lock: a filed period cannot be edited; the owner can unlock with a written reason.
- GSTIN: 15 characters, state code, PAN, entity code, `Z`, checksum.
- Due dates: GSTR-1 on the 11th (13th for quarterly), GSTR-3B on the 20th (22nd for quarterly).

## 9. API surface

Route handlers under `/api`, mirroring the old paths so the port is mechanical.

```
GET    /api/auth/status
POST   /api/auth/setup
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
PATCH  /api/auth/me
POST   /api/auth/change-password
POST   /api/auth/reset
GET    /api/auth/sessions
DELETE /api/auth/sessions/:id

GET    /api/meta
GET    /api/business              PUT /api/business
POST   /api/gstin/check
GET    /api/tax-rates             POST /api/tax-rates       PUT /api/tax-rates/:id
GET    /api/hsn                   POST /api/hsn             PUT /api/hsn/:id
GET    /api/parties               POST /api/parties         PUT /api/parties/:id
POST   /api/gst/calculate

GET    /api/sales/next-number
GET    /api/sales                 POST /api/sales
GET    /api/sales/:id             PUT /api/sales/:id
POST   /api/sales/:id/cancel
POST   /api/sales/:id/amend
GET    /api/sales/:id/pdf
GET    /api/sales/export

GET    /api/purchases             POST /api/purchases
GET    /api/purchases/:id         PUT /api/purchases/:id
POST   /api/purchases/:id/cancel
GET    /api/purchases/export

GET    /api/returns
GET    /api/returns/:key
GET    /api/returns/:key/gstr1
GET    /api/returns/:key/gstr3b
GET    /api/returns/:key/compare
GET    /api/returns/:key/:ret.:fmt
POST   /api/returns/:key/approve
POST   /api/returns/:key/filed
POST   /api/returns/:key/payment
POST   /api/returns/:key/unlock
POST   /api/returns/:key/lock

GET    /api/itc/rules
GET    /api/itc/adjustments       POST /api/itc/adjustments   DELETE /api/itc/adjustments/:id
GET    /api/itc/recon/:period
GET    /api/itc/gstr2b?period=
PATCH  /api/itc/purchases/:id

GET    /api/reports               GET /api/reports/:kind
GET    /api/reports/:kind/export

GET    /api/documents?entity_type=&entity_id=
POST   /api/documents             (multipart: entity_type, entity_id, kind, file)
GET    /api/documents/:id
GET    /api/documents/:id/file
DELETE /api/documents/:id

GET    /api/imports/kinds
GET    /api/imports/template/:kind.:fmt
POST   /api/imports/preview
POST   /api/imports/error-report
POST   /api/imports/commit
GET    /api/imports
POST   /api/imports/:id/rollback

GET    /api/home
GET    /api/backup                (owner)
GET    /api/users                 POST /api/users
PATCH  /api/users/:id
POST   /api/users/:id/reset-link
GET    /api/users/login-history
GET    /api/users/audit
```

Rules:
- JSON in, JSON out. Money is returned as integer paise; the UI formats it.
- Mutations require the `X-Requested-With: fetch` header (CSRF guard) and a valid session cookie.
  The document upload route uses `X-Requested-With: fetch` too and is `multipart/form-data`.
- Errors are `{ "error": "..." }`; `422` for validation, `409` for conflicts/locks, `401/403` for access.
- Exports and attachment downloads stream bytes with `Content-Disposition`; the bucket is never
  exposed to the browser.

## 10. Screens and UI rules

Plain, utilitarian, and readable at 360 px.

- Global stylesheet only: system font stack, 16 px body, black on white, one accent (blue links),
  1 px grey borders, 4 px radius, no shadows or gradients.
- Layout: top bar with the business name and sign-out; a simple horizontal nav
  (This month · Sales · Purchases · Returns · Reports · Import · Parties · Settings).
- Tables: bordered, compact, right-aligned numbers using tabular numerals.
- Forms: label above field, native inputs, one primary button per screen.
- Numbers: plain inputs accepting rupees with two decimals; stored as paise.
- No icons beyond text, no illustrations, no empty-state art, no tour, no modals except confirm.
- One page per area:

| Route | Screen |
|---|---|
| `/setup`, `/login`, `/reset` | Owner setup, sign in, reset password |
| `/` | This month: counts, output tax, ITC, cash payable, due dates, previous period warning, recent activity |
| `/sales`, `/sales/new`, `/sales/:id` | Sales list with filters and totals; invoice/note editor with live totals; print PDF; attachments panel |
| `/purchases`, `/purchases/new`, `/purchases/:id` | Purchase list; bill editor with ITC per line; attachments panel |
| `/returns`, `/returns/:period` | Period list; return workspace (steps, GSTR-1 sections, GSTR-3B tables, comparison, 2B summary, approve/file/pay/lock, downloads) |
| `/reports` | Report picker, filters, table, export buttons |
| `/import` | Kind picker, upload, column mapping, preview/errors, commit, history, undo |
| `/parties` | Customers and suppliers |
| `/settings` | Business, tax rates, HSN, users, audit log, backup |

`/guide` is removed. Invoice and return PDFs are opened from the record. Attachments appear as a
plain list on the sale/purchase editor: file name, size, uploaded date, a download link and a delete
button. No drag-and-drop, no previews, no thumbnails — a native file input and a list.

## 11. Auth and security

- First visit creates the owner (only when no users exist).
- Passwords: bcrypt (cost 12), minimum 10 characters, mixed.
- Sessions: 32-byte random token in an httpOnly, SameSite=Lax cookie; SHA-256 hash stored;
  expiry and revocation checked on every request; `last_seen` updated at most once a minute.
- CSRF: mutation requires `X-Requested-With: fetch`; SameSite=Lax cookie.
- Roles: only the owner edits business settings, users, unlock, lock, approve, backup.
- Login throttling: 8 failures per email per 15 minutes.
- Headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `no-store` on `/api`.
- Audit log for every create/update/delete/cancel/amend/approve/file/unlock/import/export,
  and for every attachment upload or delete.
- Uploaded files are checked by MIME type and extension, size (10 MB) and a PDF/JPEG/PNG magic-byte
  sniff before being written; the original file name is stored as metadata only.
- Secrets only in environment variables.

## 12. Imports

Kinds and fields are carried over. The pipeline:

1. **Parse** CSV, XLSX (and `.xls` only if a maintained reader is available) or JSON/ZIP from the
   GST portal. Reject over 20,000 rows and over 20 MB.
2. **Map** headers automatically with aliases, allow overrides.
3. **Validate** every row, producing per-row errors and warnings; never write.
4. **Preview** shows valid/invalid counts, grouped documents and up to 300 rows.
5. **Commit** in one transaction, records created IDs on the batch, writes the audit entry.
6. **Rollback** deletes exactly the IDs the batch created; refuses if the period is locked.

## 13. Locking, snapshots and audit

- Filing both GSTR-1 and GSTR-3B freezes a snapshot and locks the period.
- Approve is required before a period can be marked filed.
- Unlock (owner + reason) sets `locked = false`, returns both return statuses to `approved`
  (not `open`), clears the filed dates and ARNs but keeps the previous snapshot in the audit log,
  and audits the change. This fixes the old inconsistency.
- Any write touching a date or ITC period inside a locked period is rejected (including purchase
  `itc_period` and ITC eligibility edits).

## 14. Exports

| Output | Library | Notes |
|---|---|---|
| PDF | `pdfkit` | Invoices/notes on A4; reports in landscape; Indian number format; "check with your accountant" footer |
| XLSX | `exceljs` | Header styling, frozen row, Indian number format |
| CSV | hand-written | UTF-8 BOM so Excel opens Indian text correctly |
| JSON | `JSON.stringify` | GSTR-1/3B portal payloads exactly as before |

GSTR-1 payload keys: `gstin`, `fp`, `version`, `hash`, `b2b`, `b2ba`, `b2cl`, `b2cla`, `b2cs`,
`exp`, `cdnr`, `cdnra`, `cdnur`, `nil`, `hsn`, `doc_issue`.
GSTR-3B payload keys: `gstin`, `ret_period`, `sup_details`, `inter_sup`, `itc_elg`, `inward_sup`,
`intr_ltfee`.

### 14.1 Attachments

| Step | Behaviour |
|---|---|
| Upload | `POST /api/documents` with `multipart/form-data`; ≤ 10 MB; PDF, JPEG or PNG; magic bytes checked |
| Store | `lib/storage.ts` puts the bytes in `gst-documents` under `{entity_type}/{entity_id}/{uuid}.{ext}`; the `documents` row records size and checksum |
| List | `GET /api/documents?entity_type=sale&entity_id=…` returns metadata only |
| Download | `GET /api/documents/:id/file` checks the session, fetches the object and streams it with the original file name |
| Delete | `DELETE /api/documents/:id` (owner only) removes the row and the object, audited |
| Missing object | The metadata row is kept and the UI says the file is unavailable; it is never silently recreated |

Generated PDFs and reports are not written to the bucket. Only user-supplied attachments are.

## 15. Testing

- **Unit (most of the suite):** GST engine, GSTIN checksum, periods/due dates, set-off order,
  GSTR-1 figures/sections, GSTR-3B tables, comparison, reconciliation, report rows, importer
  parsing and validation.
- **Integration:** API flows with PGlite — setup/login, create sale, lock, amendment, cancel,
  import preview/commit/rollback, role checks, export content types, document upload/list/delete
  against a stubbed storage client.
- Fixtures: a business in Tamil Nadu (33), a B2B customer, a B2C customer, a supplier, a 2B file,
  a one-page PDF and a small JPEG.
- Target: every old Python test has a TypeScript equivalent, plus tests for the four defects in
  `AGENTS.md`.

## 16. Deployment

- Vercel project, standard Next.js build (`npm run build`).
- Environment: `DATABASE_URL` (Neon pooled), `DATABASE_URL_UNPOOLED` (drizzle-kit only),
  `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `S3_BUCKET=gst-documents`, `COOKIE_SECURE=true`, `APP_URL=https://…`.
- Neon project `gst-invoice`, branch `production`, region Singapore; private bucket
  `gst-documents`. Credentials are generated in the Neon console and stored only in Vercel and
  `.env.local`.
- Schema applied with `npm run db:push` (or generated migrations with `db:generate` and applied
  through a one-off job). Seed defaults idempotently on first boot.
- No server filesystem writes. No long-running processes. No cron required.

## 17. Parity checklist

Every item below must be demonstrable before the rebuild is called done.

- [ ] Setup, login, logout, change password, reset link, session list/revoke
- [ ] Owner/accountant permissions and login throttling
- [ ] Business settings with GSTIN/PAN/state consistency checks
- [ ] Tax rates, HSN/SAC, customers, suppliers
- [ ] Sales invoice, credit note, debit note; B2B/B2C/B2CL/export classification
- [ ] Amendments of filed invoices with original reference
- [ ] Purchase bill with per-line ITC, category defaults, ITC period
- [ ] GST engine: intra/inter, inclusive/exclusive, discount, cess, nil/exempt/non-GST/zero-rated, round off
- [ ] GSTR-1 JSON with every section, HSN, nil, doc issue, amendments
- [ ] GSTR-3B JSON with 3.1/3.2/4A/4B/4C/4D/5/6.1 and set-off order
- [ ] GSTR-1 vs 3B comparison
- [ ] GSTR-2B import, matching, mismatch/missing summaries, ITC deferral
- [ ] ITC adjustments and reclaims
- [ ] Approve, mark filed, ARN, payment, lock/unlock, snapshot
- [ ] All 12 reports with filters and four export formats
- [ ] Bulk import of seven kinds with preview, error CSV, commit, undo
- [ ] Invoice/note PDF and return/report PDF
- [ ] Attach, list, download and delete a bill photo or supplier PDF in Neon Object Storage
- [ ] Audit log and full JSON backup
- [ ] Typecheck, lint, tests, production build green
