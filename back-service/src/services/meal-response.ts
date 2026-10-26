import type { MealResponse, Range } from "@caloria/shared";
import type { Meal } from "../models/Meal";
import { applyCorrections } from "./meal-corrections";

/** Proyección de la consulta: solo lo que necesitan la respuesta y la firma de la foto. */
export const MEAL_RESPONSE_FIELDS = {
  capturedAt: 1,
  status: 1,
  "media.photoKey": 1,
  analysis: 1,
  corrections: 1,
  comment: 1,
  error: 1,
} as const;

export type MealResponseSource = Pick<
  Meal,
  "_id" | "capturedAt" | "status" | "analysis" | "corrections" | "comment" | "error"
>;

const range = ({ min, max }: Range): Range => ({ min, max });

/**
 * Comida → respuesta de la API (`GET /meals/:id` y el historial). Arma la respuesta campo por
 * campo según el `status`: nunca salen `userId`, las keys del bucket, `promptVersion`, `model`,
 * `attempts`, la transcripción, la nota ni el historial de `corrections`. Los valores son los del
 * análisis con las correcciones aplicadas. `photoUrl` llega ya firmada.
 */
export function toMealResponse(meal: MealResponseSource, photoUrl: string): MealResponse {
  const id = meal._id.toString();
  const capturedAt = meal.capturedAt.toISOString();
  switch (meal.status) {
    case "processing":
      return { id, status: "processing", capturedAt, photoUrl };
    case "ready": {
      if (!meal.analysis) throw new Error(`La comida ${id} está ready sin análisis`);
      const { dish, items, kcal, macros } = applyCorrections(meal.analysis, meal.corrections);
      return {
        id,
        status: "ready",
        capturedAt,
        photoUrl,
        dish,
        items: items.map((item) => ({
          name: item.name,
          grams: range(item.grams),
          kcal: range(item.kcal),
        })),
        kcal: range(kcal),
        macros: {
          protein: range(macros.protein),
          carbs: range(macros.carbs),
          fat: range(macros.fat),
        },
        confidence: meal.analysis.confidence,
        ...(meal.comment && { comment: { tone: meal.comment.tone, text: meal.comment.text } }),
      };
    }
    case "failed":
      if (!meal.error) throw new Error(`La comida ${id} está failed sin error.code`);
      return { id, status: "failed", capturedAt, photoUrl, error: { code: meal.error.code } };
  }
}
