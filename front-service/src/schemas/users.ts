import { z } from "zod";
import { updateMeSchema } from "@caloria/shared";

export const TONES = ["motivador", "neutro", "roast", "off"] as const;

// El esquema es el de shared más `tone`, que el Backend todavía no acepta (RF-11).
export const updateMeRequestSchema = updateMeSchema.safeExtend({
  tone: z.enum(TONES).optional(),
});
