import { correctableFieldsSchema } from "@caloria/shared";
import type { CorrectableFields } from "@caloria/shared";
import type { Correction } from "../models/Meal";

// Una corrección es un único campo con su valor completo: un campo desconocido no pasa.
const correctionSchema = correctableFieldsSchema.partial().strict();

/**
 * Valores finales de una comida: los del análisis con las correcciones aplicadas en orden,
 * la última gana. `analysis` queda como lo devolvió la IA. Lo usan `GET /meals/:id`, el historial,
 * el dashboard y el PATCH, así todos muestran y suman lo mismo. Una corrección con un campo
 * desconocido o un valor que no pasa zod se ignora.
 */
export function applyCorrections(
  analysis: CorrectableFields,
  corrections: readonly Correction[],
): CorrectableFields {
  const { dish, items, kcal, macros } = analysis;
  const values: CorrectableFields = { dish, items, kcal, macros };
  for (const { field, to } of corrections) {
    if (to === undefined) continue;
    const parsed = correctionSchema.safeParse({ [field]: to });
    if (parsed.success) Object.assign(values, parsed.data);
  }
  return values;
}
