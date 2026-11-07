import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A database handle or an open transaction on it. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

const g = globalThis as unknown as { __gstDb?: Promise<Db> };

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function openPglite(dir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dir) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir || undefined);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

function openPostgres(url: string): Db {
  // prepare:false keeps it compatible with Neon's pooled (PgBouncer) endpoint.
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
  return drizzlePg(client, { schema }) as unknown as Db;
}

/**
 * The shared database handle. DATABASE_URL is a Neon/Postgres URL in production.
 * For local development and tests only, "pglite:<dir>" (or "pglite:" for in-memory)
 * runs an embedded Postgres and applies migrations on first use.
 */
export function getDb(): Promise<Db> {
  if (!g.__gstDb) {
    const url = process.env.DATABASE_URL ?? "";
    if (url.startsWith("pglite:")) g.__gstDb = openPglite(url.slice("pglite:".length));
    else if (url) g.__gstDb = Promise.resolve(openPostgres(url));
    else return Promise.reject(new Error("DATABASE_URL is not set"));
  }
  return g.__gstDb;
}

/** Tests: replace the shared handle. */
export function setDb(db: Db | null): void {
  g.__gstDb = db ? Promise.resolve(db) : undefined;
}

export { schema };
