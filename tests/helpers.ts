import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { setDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { gstinCheckChar } from "@/lib/gst/gstin";

export async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  setDb(db as unknown as Db);
  return db as unknown as Db;
}

/** Build a GSTIN with a correct checksum. */
export function gstin(state: string, pan: string): string {
  const first = `${state}${pan}1Z`;
  return first + gstinCheckChar(first);
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export class Client {
  cookie = "";

  async call(handler: Handler, opts: { method?: string; path?: string; body?: unknown; params?: Record<string, string>; csrf?: boolean; form?: FormData } = {}) {
    const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.csrf !== false && method !== "GET") headers["x-requested-with"] = "fetch";
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const req = new Request(`http://localhost${opts.path ?? "/api/x"}`, { method, headers, body });
    const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json") && !res.headers.get("content-disposition") ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, res };
  }
}

export const OWNER = { name: "Owner", email: "owner@example.com", password: "correct horse 42" };
