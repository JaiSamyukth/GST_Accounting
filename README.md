# GST-Invoice

GST accounting for Dev Caters, Trichy — rebuilt as a single Next.js application for Vercel, with Neon Postgres.

Record sales and purchase bills, check input tax credit against GSTR-2B, prepare GSTR-1 and GSTR-3B every month, and print or download the papers as PDF, Excel, CSV or JSON.

> **Status: planning.** This repository currently contains the specification and implementation plan. Application code lands only after the spec and plan are approved.

## What it is

- **One app.** Next.js (App Router, TypeScript) serves both the screens and the `/api` routes. No separate Python service.
- **Neon Postgres.** All data, including sessions and the audit log.
- **Vercel.** Deployed as a standard Next.js project.
- **Plain UI.** White background, system fonts, ordinary forms and tables. No theme, no tour, no animation.
- **PDF output.** Invoices, credit/debit notes, returns and reports are generated as PDF on demand. Files are not uploaded or stored.

## Modules

| Module | What it does |
|---|---|
| Business and GST settings | GSTIN/PAN validation, state, monthly or quarterly filing, rates, HSN/SAC |
| Customers and suppliers | Master list, GSTIN checks |
| Sales | Invoices, credit and debit notes, B2B/B2C/B2C large/export, amendments |
| Purchases | Supplier bills, categories, per-line ITC eligibility with reasons |
| GST engine | CGST+SGST or IGST, inclusive/exclusive, discounts, nil/exempt/non-GST/zero-rated, round off |
| ITC | GSTR-2B import and matching, missing and mismatched bills, reversals and reclaims |
| GSTR-1 | b2b, b2cl, b2cs, exp, cdnr, cdnur, nil, HSN, doc issue, amendments; JSON, Excel, PDF, CSV |
| GSTR-3B | 3.1, 3.2, 4A–4D, 5, 6.1 with legal set-off order; GSTR-1 vs 3B comparison |
| Return record | Approval, payment, ARN, filing date, acknowledgements, period lock |
| Reports | 12 reports with FY/month/quarter/date filters; PDF, Excel, CSV, JSON |
| Users | Owner and accountant roles, sessions, login history, reset links, audit log |
| Import | CSV and XLSX for sales, notes, purchases, parties, HSN, payments; preview, errors, undo |
| Backup | Full JSON backup of every table |

## Planned stack

- Next.js App Router, React 19, TypeScript strict
- Drizzle ORM + `postgres` driver, Neon Postgres
- Cookie sessions, bcrypt password hashes
- PDFKit, ExcelJS, `csv-parse`, `fflate`, Zod
- Vitest + PGlite for tests
- One hand-written stylesheet

## Local setup (after implementation)

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL
npm run db:push
npm run db:seed
npm run dev
```

Open http://localhost:3000. The first visit asks for the owner's account.

## Deploy

1. Create a Neon project and copy the **pooled** connection string.
2. Import this repository in Vercel and add `DATABASE_URL`.
3. Run `npm run db:push` once against Neon (locally or in the build step).
4. Deploy.

See `docs/spec.md` for the full design and `docs/plan.md` for the build plan.
