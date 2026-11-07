import { deleteDocument, getDocument } from "@/lib/attachments";
import { idParam } from "@/lib/http";
import { route } from "@/lib/route";

export const GET = route<{ id: string }>({}, async ({ db, params }) => ({ document: await getDocument(db, idParam(params.id)) }));

export const DELETE = route<{ id: string }>({ owner: true }, async ({ db, user, params }) => {
  await deleteDocument(db, user, idParam(params.id));
  return { ok: true };
});
