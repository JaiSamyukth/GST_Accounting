import { IMPORT_KINDS, KINDS } from "@/lib/gst/importers";
import { route } from "@/lib/route";

export const GET = route({}, async () => ({ kinds: IMPORT_KINDS.map((k) => ({ kind: k, label: KINDS[k].label, fields: KINDS[k].fields })) }));
