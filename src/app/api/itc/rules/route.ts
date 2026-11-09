import { ITC_RULES } from "@/lib/itc";
import { route } from "@/lib/route";

export const GET = route({}, async () => ({ rules: ITC_RULES }));
