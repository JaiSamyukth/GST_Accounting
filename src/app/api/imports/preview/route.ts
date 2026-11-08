import { analyse, previewResponse, readImportForm } from "@/lib/imports-service";
import { route } from "@/lib/route";

/** Validate an upload and show what would be imported. Writes nothing. */
export const POST = route({}, async ({ req, db }) => {
  const f = await readImportForm(req);
  return previewResponse(f.kind, await analyse(db, f.kind, f.table, f.mapping, { update: f.update }));
});
