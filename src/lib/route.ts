import { getDb, type Db } from "../db/client";
import { assertOwner, getSessionUser, requireUser, type SessionUser } from "./auth";
import { errorResponse, HttpError, json } from "./http";

type Params = Record<string, string>;
interface NextCtx { params: Promise<Params> }

export interface Ctx<P extends Params = Params> {
  req: Request;
  db: Db;
  params: P;
}

function checkCsrf(req: Request): void {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;
  if (req.headers.get("x-requested-with") !== "fetch") throw new HttpError(403, "Missing X-Requested-With header");
}

function wrap(result: unknown): Response {
  return result instanceof Response ? result : json(result ?? { ok: true });
}

/** A route that needs no session (setup, login, reset, status). */
export function publicRoute<P extends Params = Params>(fn: (c: Ctx<P> & { user: SessionUser | null }) => Promise<unknown>) {
  return async (req: Request, ctx?: NextCtx): Promise<Response> => {
    try {
      checkCsrf(req);
      const db = await getDb();
      const params = ((await ctx?.params) ?? {}) as P;
      const user = await getSessionUser(db, req);
      return wrap(await fn({ req, db, params, user }));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** A route for any signed-in user, or only the owner. */
export function route<P extends Params = Params>(
  opts: { owner?: boolean },
  fn: (c: Ctx<P> & { user: SessionUser }) => Promise<unknown>,
) {
  return async (req: Request, ctx?: NextCtx): Promise<Response> => {
    try {
      checkCsrf(req);
      const db = await getDb();
      const user = await requireUser(db, req);
      if (opts.owner) assertOwner(user);
      const params = ((await ctx?.params) ?? {}) as P;
      return wrap(await fn({ req, db, params, user }));
    } catch (e) {
      return errorResponse(e);
    }
  };
}
