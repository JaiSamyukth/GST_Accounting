import { idParam } from "@/lib/http";
import { rollbackImport } from "@/lib/imports-service";
import { route } from "@/lib/route";

export const POST = route<{ id: string }>({}, async ({ db, user, params }) => ({ batch: await rollbackImport(db, user, idParam(params.id)) }));
