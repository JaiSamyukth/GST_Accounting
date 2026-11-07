import { isPeriodKey, dueDates, periodRange } from "@/lib/gst/periods";
import { notFound } from "@/lib/http";
import { ensurePeriod, returnsFor } from "@/lib/returns-service";
import { route } from "@/lib/route";

function key(params: { key: string }): string {
  if (!isPeriodKey(params.key)) throw notFound("Unknown period");
  return params.key;
}

export const GET = route<{ key: string }>({}, async ({ db, params }) => {
  const k = key(params);
  const row = await ensurePeriod(db, k);
  const r = await returnsFor(db, k);
  const { snapshot: _snapshot, figures: _figures, ...status } = row;
  void _snapshot; void _figures;
  return {
    period: k,
    range: periodRange(k),
    due: dueDates(k),
    status,
    fromSnapshot: r.fromSnapshot,
    gstr1Summary: r.gstr1.summary,
    gstr1Totals: r.gstr1.totals,
    gstr3b: { t31: r.gstr3b.t31, t4: r.gstr3b.t4, payment: r.gstr3b.payment },
    compare: r.compare,
    issues: r.issues,
  };
});
