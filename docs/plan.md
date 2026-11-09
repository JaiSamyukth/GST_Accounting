# GST Accounting — implementation plan

Companion to `docs/spec.md`. Work proceeds in phases; each phase ends with a commit and the
gate checks green (`typecheck`, `lint`, `test`, `build`). No phase starts before the prior one
is usable.

---

## Phase 0 — Repository and skeleton

**Goal:** an empty Next.js app that builds on Vercel.

- `package.json` with Next.js, React, TypeScript, Drizzle, `postgres`, `zod`, `bcryptjs`,
  `pdfkit`, `exceljs`, `csv-parse`, `fflate`, `@aws-sdk/client-s3`,
  `@aws-sdk/s3-request-presigner`, Vitest, PGlite, ESLint.
- `next.config.ts`, `tsconfig.json` (strict), `.eslintrc`, `vitest.config.ts`, `drizzle.config.ts`.
- `src/app/layout.tsx`, `globals.css`, a placeholder home page.
- `src/db/client.ts` (`postgres` + Drizzle, singleton in dev), `src/db/schema.ts` stub.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`, `db:push`, `db:seed`.
- `.env.example` already present.

**Done when:** `npm run build`, `npm run typecheck`, `npm test` pass with zero tests.

## Phase 1 — Money, GSTIN, periods

**Goal:** the exact primitives the rest depends on.

- `src/lib/money.ts`: paise conversions, `formatINR`, `roundHalfUp`, parsing rupees.
- `src/lib/gst/gstin.ts`: states, regex, GSTIN checksum, PAN, state from GSTIN.
- `src/lib/gst/periods.ts`: FY, month/quarter keys, ranges, labels, periods for FY, due dates,
  return FP.
- Port the old tests: `test_gstin.py`, `test_periods.py` plus boundary cases
  (29 Feb, Q4 in the next calendar year, 16-char invoice numbers).

**Done when:** unit tests cover every function; no framework imports.

## Phase 2 — GST engine

**Goal:** `calcLine`, `calcDocument`, `classifySalesDoc` in TypeScript, matching old figures.

- Line input/result types; per-line half-up rounding; intra/inter split; cess.
- Inclusive mode with residual absorption into taxable value.
- Supply kinds; exports forced zero-rated; non-taxable forces rate 0; validation errors.
- Document totals, round off, by-rate and by-kind buckets.
- `POST /api/gst/calculate` route handler (Zod schema).
- Port `test_gst_engine.py` with hand-computed expectations, including:
  5% catering, 18% inclusive, discount, cess, zero-rated export, sub-paisa rounding.

**Done when:** every ported test passes and amounts equal the Python results to the paisa.

## Phase 3 — Database and auth

**Goal:** schema in Neon and a working sign-in.

- Full `schema.ts` per spec section 7, with indexes and unique constraints, including `documents`.
- `drizzle.config.ts`; generate the first migration; `db:push`.
- `src/lib/storage.ts`: S3 client for Neon Object Storage (`putObject`, `getObject`,
  `deleteObject`), path-style addressing, no public ACLs.
- `src/lib/auth.ts`: bcrypt hash/verify, password rules, token creation, cookie helpers,
  `requireUser`, `requireOwner`.
- Routes: status, setup, login, logout, me, change-password, reset, sessions list/revoke.
- CSRF header check and security headers via `middleware.ts` or a shared handler wrapper.
- `audit_log` helper.
- Seed: business row, six tax rates, ten HSN codes (idempotent).
- Integration tests on PGlite: setup once, second setup rejected, login, throttling, roles,
  session expiry, reset token single use.

**Done when:** sign-in works against Neon locally and in a Vercel preview, and a test object can be
written to and read from `gst-documents`.

## Phase 4 — Masters and settings

- `business` get/put with GSTIN/PAN/state/frequency validation.
- `meta` (states, UQC, supply kinds, rates, periods).
- `tax-rates`, `hsn`, `parties` CRUD with owner checks where the old app had them.
- Screens: Settings (business, rates, HSN, users, audit, backup placeholder), Parties.
- Audit every change.

**Done when:** the owner can configure the business end to end.

## Phase 5 — Sales and purchases

- `src/lib/docs.ts`: build/validate sales and purchase documents, category ITC defaults,
  section classification, lock checks.
- Sales CRUD, cancel, amend (number suffix `~A`, original link, amend period).
- Purchase CRUD, cancel; `itc_period`; eligibility per line.
- Filters, pagination and accurate totals in SQL (fixing defect 1).
- Invoice/credit-note PDF (`pdfkit`): business header, GSTIN, place of supply, HSN lines,
  tax summary, amount in words, signature line.
- Attachments: `POST/GET/DELETE /api/documents`, 10 MB cap, PDF/JPEG/PNG sniffing, private
  streaming route, delete restricted to the owner, audited.
- Screens: sales list, purchase list, shared document editor with live totals, print, attachments
  panel (native file input plus a list).
- Tests: totals, classification, amendments, lock rejection, PDF returns a `%PDF` body,
  upload rejects oversize/wrong-type, delete removes the object.

**Done when:** a sale and a purchase can be entered, edited, cancelled, amended and printed.

## Phase 6 — Returns

- `src/lib/gst/returns.ts`: `buildGstr1`, `buildGstr3b`, `compare1vs3b`, set-off.
- Routes: period list/overview, gstr1, gstr3b, compare, approve, filed, payment, lock.
- Unlock fix: clear filed state consistently, keep audit trail (defect 2).
- Exports: JSON payloads, XLSX sheets, CSV, PDF for both returns.
- Screen: returns list with status/due/overdue, workspace with step checklist, section tables,
  comparison, issue list, actions and downloads.
- Tests: figures per section, nil split, amendments, deferred ITC, RCM cash, snapshot on file.

**Done when:** a month produces valid GSTR-1 and GSTR-3B JSON that match hand calculations.

## Phase 7 — ITC and GSTR-2B

- `src/lib/gst/recon.ts`: normalise invoice numbers, match, probable, mismatch, missing both ways.
- 2B import from portal JSON/ZIP (reuse the import pipeline), listing by period.
- Adjustments CRUD with lock checks; reverse/reclaim in 3B.
- ITC eligibility edits respect the ITC period lock (defect 4).
- Screen: matching summary, rows, filters, mark eligible/ineligible, adjustments.

**Done when:** a 2B file reconciles and the 3B figures reflect matches and reversals.

## Phase 8 — Reports

- `src/lib/gst/reports.ts`: all 12 report builders.
- Report list, date/FY/month/quarter filters, table view.
- XLSX, CSV, JSON, PDF export via shared exporters.

**Done when:** each report returns rows for a seeded period and exports open correctly.

## Phase 9 — Import wizard

- `src/lib/gst/importers.ts`: seven kinds, header aliases, auto-map, coercion, validation,
  grouping, duplicate detection, templates, error report, commit, rollback.
- Route handlers: kinds, template, preview, error-report, commit, history, rollback.
- Screen: choose kind → upload → map → preview → commit → history/undo.
- Tests: malformed rows, missing required fields, duplicate invoice numbers, rollback restores.

**Done when:** a sample sheet of each kind imports and can be undone.

## Phase 10 — Home, users, backup, polish

- Home dashboard: counts, output tax, ITC, cash payable, due dates, previous-period warning,
  recent audit events, setup warnings.
- Users: create with invite link, role/active changes, reset links, login history, audit viewer.
- Backup: owner-only ZIP of JSON per table, password hashes excluded.
- Plain-CSS pass across every screen at 360 px and 1280 px; keyboard focus states; labels.
- Empty states as single sentences.

**Done when:** the parity checklist in the spec is fully ticked.

## Phase 11 — Deployment and handover

- Add `vercel.json` if needed; confirm Node runtime.
- Neon project, pooled and unpooled URLs, private `gst-documents` bucket.
- Vercel environment: `DATABASE_URL`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, `COOKIE_SECURE=true`, `APP_URL`.
- Run `db:push` and `db:seed` against Neon.
- Deploy, create the owner, enter one real sale and one purchase, attach a bill photo, produce both
  returns.
- README screenshots replaced with text steps; document backup and restore.
- Tag `v1.0.0`.

**Done when:** a real month can be filed from the production URL.

---

## Execution order and estimates

| Phase | Depends on | Rough size |
|---|---|---|
| 0 Skeleton | — | S |
| 1 Primitives | 0 | S |
| 2 Engine | 1 | M |
| 3 DB + auth | 0, 1 | M |
| 4 Masters | 3 | M |
| 5 Sales/purchases | 2, 4 | L |
| 6 Returns | 5 | L |
| 7 ITC/2B | 6 | M |
| 8 Reports | 6 | M |
| 9 Import | 5, 7 | L |
| 10 Home/users/backup | 6, 8 | M |
| 11 Deploy | all | S |

## Risks

| Risk | Mitigation |
|---|---|
| Paise arithmetic diverges from the Python `Decimal` engine | Port the old test vectors first; compare against the old app on the same fixture data |
| GSTR JSON schema drift | Keep the schema version string and portal key names; validate exports with the GST offline tool |
| Neon cold starts / connection limits | Pooled connection string, singleton client, no per-request `new Pool` |
| PDFKit fonts on Vercel | Bundle a TTF in the repo; do not rely on system fonts |
| ExcelJS memory on large reports | Cap report ranges and stream exports; imports capped at 20k rows |
| Object storage unreachable or credential rotated | Fail the upload with a clear 503, keep the metadata unwritten; read credentials from env at request time |
| Large upload exhausts a serverless function | 10 MB cap enforced before buffering; reject early from `Content-Length` |
| GST rate changes | Rates are data, editable in Settings; no hard-coded rate in logic |
