import { z } from "zod";
import type { ZodType } from "zod";

export const MAX_DEPTH = 16;

const UNSAFE_KEY = /[$.]/;

function checkKeys(value: unknown, path: (string | number)[], ctx: z.RefinementCtx): void {
  if (typeof value !== "object" || value === null) return;
  if (path.length >= MAX_DEPTH) {
    ctx.addIssue({ code: "custom", message: "Anidamiento excesivo", path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkKeys(item, [...path, index], ctx));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key)) {
      ctx.addIssue({ code: "custom", message: "Clave no permitida", path });
      return;
    }
    checkKeys(item, [...path, key], ctx);
  }
}

export function withoutOperatorKeys<T extends ZodType>(schema: T) {
  return z
    .unknown()
    .superRefine((value, ctx) => checkKeys(value, [], ctx))
    .pipe(schema);
}
