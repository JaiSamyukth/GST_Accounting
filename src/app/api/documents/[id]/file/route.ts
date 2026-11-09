import { readDocumentFile } from "@/lib/attachments";
import { idParam } from "@/lib/http";
import { route } from "@/lib/route";

export const GET = route<{ id: string }>({}, async ({ db, params }) => {
  const { row, bytes } = await readDocumentFile(db, idParam(params.id));
  const inline = row.mimeType === "application/pdf" || row.mimeType.startsWith("image/");
  const safe = row.filename.replace(/[^\w.\-]+/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
