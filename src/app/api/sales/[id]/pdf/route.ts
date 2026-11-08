import { getSale } from "@/lib/docs";
import { invoicePdf } from "@/lib/export/pdf";
import { portalNumber } from "@/lib/gst/returns";
import { attachment, idParam } from "@/lib/http";
import { route } from "@/lib/route";
import { getBusiness } from "@/lib/settings";

const TITLES = { invoice: "Tax Invoice", credit_note: "Credit Note", debit_note: "Debit Note" } as const;

export const GET = route<{ id: string }>({}, async ({ db, params }) => {
  const { doc, lines } = await getSale(db, idParam(params.id));
  const biz = await getBusiness(db);
  const base = doc.isExport ? (doc.exportWithIgst ? "Tax Invoice (Export with IGST)" : "Tax Invoice (Export under LUT, without IGST)") : TITLES[doc.docType];
  const title = doc.amendsId ? `Revised ${base}` : base;
  const number = portalNumber(doc.number);
  const bytes = await invoicePdf(biz, { ...doc, number, title, cancelled: doc.status === "cancelled", lines });
  return attachment(Buffer.from(bytes), `${number}${doc.amendsId ? "-revised" : ""}.pdf`, "application/pdf");
});
