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

export const MACROS = ["protein", "carbs", "fat"] as const;

/** Lo mismo que `rangeSchema`: números, sin negativos, finitos y con min ≤ max. */
const validRange = (path: string) => ({
  $and: [
    { $isNumber: `${path}.min` },
    { $isNumber: `${path}.max` },
    { $gte: [`${path}.min`, 0] },
    { $lte: [`${path}.min`, `${path}.max`] },
    { $lt: [`${path}.max`, Infinity] },
  ],
});

// Lo que acepta correctableFieldsSchema para cada campo. $and corta en el primer false: $trim
// solo ve strings.
const VALID: Record<"dish" | "kcal" | "macros", object> = {
  dish: {
    $and: [
      { $eq: [{ $type: "$$c.to" }, "string"] },
      { $gt: [{ $strLenCP: { $trim: { input: "$$c.to" } } }, 0] },
    ],
  },
  kcal: validRange("$$c.to"),
  macros: { $and: MACROS.map((macro) => validRange(`$$c.to.${macro}`)) },
};

/**
 * `applyCorrections` para un campo dentro de una agregación: la última corrección válida del
 * campo gana; si no hay, queda el del análisis. La usan el dashboard y el Wrapped, y un test
 * compara las dos. `dish` sale sin recortar: el que lo muestre hace el trim.
 */
export function currentValue(field: "dish" | "kcal" | "macros") {
  return {
    $let: {
      vars: {
        last: {
          $last: {
            $filter: {
              input: "$corrections",
              as: "c",
              cond: { $and: [{ $eq: ["$$c.field", field] }, VALID[field]] },
            },
          },
        },
      },
      in: { $ifNull: ["$$last.to", `$analysis.${field}`] },
    },
  };
}
