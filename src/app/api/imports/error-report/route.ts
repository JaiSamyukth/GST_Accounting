import { attachment } from "@/lib/http";
import { analyse, errorReportCsv, readImportForm } from "@/lib/imports-service";
import { route } from "@/lib/route";

export const POST = route({}, async ({ req, db }) => {
  const f = await readImportForm(req);
  const csv = errorReportCsv(await analyse(db, f.kind, f.table, f.mapping, { update: f.update }));
  return attachment(csv, `${f.kind}-import-errors.csv`, "text/csv; charset=utf-8");
});
