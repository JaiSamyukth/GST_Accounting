import { listBatches } from "@/lib/imports-service";
import { route } from "@/lib/route";

export const GET = route({}, async ({ db }) => ({ batches: await listBatches(db) }));
