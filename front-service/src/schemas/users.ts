import { z } from "zod";
import { updateMeSchema } from "@caloria/shared";

export const MAX_PUSH_TOKENS = 10;

const expoPushToken = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,256}\]$/);

// Perfil y tono con el mismo esquema que el Backend. pushTokens lo valida solo el Front hasta RF-13.
export const updateMeRequestSchema = z
  .object({
    profile: updateMeSchema.shape.profile,
    tone: updateMeSchema.shape.tone,
    pushTokens: z
      .array(expoPushToken)
      .max(MAX_PUSH_TOKENS)
      .refine((tokens) => new Set(tokens).size === tokens.length, {
        message: "Push tokens repetidos",
      })
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Indicá al menos un campo" });
