import { json } from "@/lib/http";
import { analyse, commitImport, readImportForm } from "@/lib/imports-service";
import { route } from "@/lib/route";

export const POST = route({}, async ({ req, db, user }) => {
  const f = await readImportForm(req);
  const batch = await commitImport(db, user, f.kind, f.filename, await analyse(db, f.kind, f.table, f.mapping, { update: f.update }));
  return json({ batch }, 201);
});
