import { mkdirSync } from "node:fs";
import path from "node:path";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
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
  // node-postgres pool on Neon's pooled (-pooler, PgBouncer) endpoint. One pool per server
  // instance; on Vercel Fluid compute, attachDatabasePool closes idle clients before the
  // instance suspends so connections are not leaked. Outside Vercel it does nothing.
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
  pool.on("error", (e) => console.error("Idle database client error", e.message));
  attachDatabasePool(pool);
  return drizzlePg(pool, { schema }) as unknown as Db;
}

/**
 * Neon's WebSocket driver (port 443). Opt in with DATABASE_DRIVER=neon-ws on networks that block
 * Postgres port 5432; it goes through HTTPS_PROXY when one is set. Production on Vercel uses `pg`.
 */
async function openNeonWs(url: string): Promise<Db> {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  neonConfig.webSocketConstructor = await neonWebSocket();
  return drizzle(new Pool({ connectionString: url, max: 5 }), { schema }) as unknown as Db;
}

export async function neonWebSocket() {
  const { default: WS } = await import("ws");
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return WS;
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  const agent = new HttpsProxyAgent(proxy);
  return class extends WS {
    constructor(address: string | URL, protocols?: string | string[], options?: ConstructorParameters<typeof WS>[2]) {
      super(address, protocols, { ...(options ?? {}), agent });
    }
  };
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
    else if (url && process.env.DATABASE_DRIVER === "neon-ws") g.__gstDb = openNeonWs(url);
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
