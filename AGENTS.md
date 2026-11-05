# AGENTS.md — GST-Invoice

Instructions for coding agents working in this repository. Read `docs/spec.md` and `docs/plan.md` first.

## What this is

A GST accounting application for one catering business. It records sales and purchase bills, prepares GSTR-1 and GSTR-3B, and produces PDF/Excel/CSV/JSON output. It runs as one Next.js project on Vercel with Neon Postgres.

## Hard rules

1. **No Python. No second service.** Everything is Next.js — pages and `/api` route handlers in the same project.
2. **No uploaded files.** Documents are generated (PDF/XLSX/CSV/JSON) and streamed. There is no object storage and no `documents` table.
3. **No theming.** The UI is plain: white background, system font stack, black/grey text, simple bordered tables and forms. No custom palette, webfonts, illustrations, tour, glossary widget or animation. One stylesheet. Do not add a component library.
4. **All money is integer paise** (`bigint` columns, `number` in code). Never use floats for money. Rates are integer basis points (5% = 500 bp). Round half-up per line tax component.
5. **All GST computation is server-side.** The browser may call `POST /api/gst/calculate` for a live preview; it must never be the source of truth.
6. **Every financial mutation is audited** and blocked when the period is locked.
7. **TypeScript strict.** No `any` in domain code. Validate input with Zod at the boundary.
8. **Tests first for GST logic.** Port the existing Python tests; do not change a tax rule without a failing test.

## Structure

```
src/app/          routes and pages (App Router)
src/app/api/      route handlers, one folder per resource
src/components/   plain shared UI (table, field, button, dialog)
src/lib/          domain logic, framework-free and unit-testable
src/lib/gst/      gst.ts, gstin.ts, periods.ts, returns.ts, recon.ts, importers.ts, reports.ts
src/db/           schema.ts, client.ts, seed.ts
drizzle/          generated SQL migrations
tests/            Vitest unit and integration tests
docs/             spec.md, plan.md
```

Keep `src/lib` free of React and Next.js imports. A domain function must be callable from a script and testable without a browser.

## Commands

```bash
npm run dev          # local development
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run db:generate  # drizzle-kit generate
npm run db:push      # apply schema to DATABASE_URL
npm run db:seed      # business defaults, rates, HSN
```

## Conventions

- Money helpers live in `src/lib/money.ts`: `paise()`, `formatINR()`, `roundHalfUp()`.
- Period keys: monthly `YYYY-MM`, quarterly `YYYY-Qn` (financial-year quarter, FY starts April).
- Dates are ISO `YYYY-MM-DD` strings at the API boundary and `date` columns in Postgres.
- API errors: `{ "error": "message" }` with 400/401/403/404/409/422. Never leak stack traces.
- Naming mirrors the old app so behaviour is easy to compare: `SalesDoc`, `Purchase`, `ReturnPeriod`, `ItcAdjustment`, `Gstr2bEntry`.
- Prefer small files. If a module passes ~500 lines, split it.

## Known defects from the old app — fix, do not port

1. Purchase list applied the ITC filter after pagination; filter in SQL and keep `total` accurate.
2. Unlocking a filed period cleared `locked` but left the statuses `filed` and the snapshot in place. Unlock must restore an editable state consistently.
3. `docs/design.md` referenced a non-existent `schemas_gst.py`.
4. ITC eligibility changes and purchase `itc_period` changes must respect the lock of the ITC period, not only the bill date.

## Definition of done

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass.
- New GST behaviour has a unit test with a hand-computed expected value.
- The change works against Neon Postgres, not only SQLite/PGlite.
- `docs/spec.md` is updated when behaviour changes.
