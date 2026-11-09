import { REPORTS } from "@/lib/reports";
import { route } from "@/lib/route";

export const GET = route({}, async () => ({ reports: Object.entries(REPORTS).map(([kind, title]) => ({ kind, title })) }));
