import { isIsoDate, isPeriodKey } from "./gst/periods";
import { unprocessable } from "./http";
import type { ListFilter } from "./docs";

export function listFilter(sp: URLSearchParams): ListFilter {
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const period = sp.get("period") || undefined;
  if (from && !isIsoDate(from)) throw unprocessable("From must be YYYY-MM-DD");
  if (to && !isIsoDate(to)) throw unprocessable("To must be YYYY-MM-DD");
  if (period && !isPeriodKey(period)) throw unprocessable("Period must be YYYY-MM or YYYY-Qn");
  return {
    from, to, period,
    docType: sp.get("docType") || undefined,
    status: sp.get("status") || undefined,
    q: sp.get("q")?.trim() || undefined,
    page: Number(sp.get("page") ?? 1) || 1,
    pageSize: Number(sp.get("pageSize") ?? 50) || 50,
  };
}
