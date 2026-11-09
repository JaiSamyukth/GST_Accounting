import { ZodError, type ZodType } from "zod";
import { GstValidationError } from "./gst/gst";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Please sign in") => new HttpError(401, m);
export const forbidden = (m = "Only the owner can do this") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
export const unprocessable = (m: string) => new HttpError(422, m);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const where = first?.path.length ? first.path.join(".") + ": " : "";
    return json({ error: where + (first?.message ?? "Invalid input") }, 422);
  }
  if (e instanceof GstValidationError) return json({ error: e.message }, 422);
  const pg = e as { code?: string; cause?: { code?: string } };
  const code = pg?.code ?? pg?.cause?.code;
  if (code === "23505") return json({ error: "A record with the same number or name already exists" }, 409);
  console.error(e);
  return json({ error: "Something went wrong" }, 500);
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  return schema.parse(body);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
}

export function idParam(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
}

export function attachment(body: BodyInit, filename: string, contentType: string): Response {
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}
