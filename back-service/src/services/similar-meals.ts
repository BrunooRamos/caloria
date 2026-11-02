import type { Types } from "mongoose";
import type { CorrectableFields } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import type { Correction } from "../models/Meal";

// Cuántas comidas corregidas van como contexto al prompt.
export const SIMILAR_MEALS_LIMIT = 5;
// Tope del texto de búsqueda: la transcripción de 60 s entra entera.
const SEARCH_MAX_CHARS = 2_000;

/** Una comida corregida del usuario: lo que dijo la IA y lo que corrigió la persona. */
export interface SimilarMeal {
  id: Types.ObjectId;
  analysis: CorrectableFields;
  corrections: Correction[];
}

export interface SimilarMealsQuery {
  userId: Types.ObjectId;
  /** La comida que se está analizando: nunca es contexto de sí misma. */
  excludeMealId: Types.ObjectId;
  /** Textos con los que buscar: plato e ingredientes identificados, nota, transcripción. */
  terms: string[];
}

/**
 * Busca comidas corregidas parecidas. Lo usa el Worker antes de llamar a la IA; la
 * primera versión es full-text de Mongo y se puede cambiar por embeddings sin tocar el job.
 */
export interface SimilarMealsFinder {
  /** Si el usuario tiene alguna comida corregida. Si no, no hace falta identificar el plato. */
  hasCandidates(userId: Types.ObjectId): Promise<boolean>;
  /** Hasta SIMILAR_MEALS_LIMIT comidas `ready` con correcciones, la más parecida primero. */
  find(query: SimilarMealsQuery): Promise<SimilarMeal[]>;
}

/**
 * Texto para `$search`: solo letras y números. Así un término de la persona no puede ser una frase
 * exacta (`"…"`) ni una exclusión (`-palabra`), y la búsqueda queda como OR de palabras.
 */
export function toSearchText(terms: readonly string[]): string {
  const words = terms
    .join(" ")
    .slice(0, SEARCH_MAX_CHARS)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  return [...new Set(words)].join(" ");
}

export function createMongoSimilarMealsFinder(): SimilarMealsFinder {
  const corrected = (userId: Types.ObjectId) => ({
    userId,
    status: "ready" as const,
    "corrections.0": { $exists: true },
  });

  return {
    async hasCandidates(userId) {
      return (await MealModel.exists(corrected(userId))) !== null;
    },

    async find({ userId, excludeMealId, terms }) {
      const search = toSearchText(terms);
      if (!search) return [];
      // El índice similar_meals ({ userId, search.* }) acota al usuario; los demás filtros se
      // aplican sobre esas pocas comidas.
      const meals = await MealModel.find(
        { ...corrected(userId), _id: { $ne: excludeMealId }, $text: { $search: search } },
        {
          score: { $meta: "textScore" },
          "analysis.dish": 1,
          "analysis.items": 1,
          "analysis.kcal": 1,
          "analysis.macros": 1,
          corrections: 1,
        },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(SIMILAR_MEALS_LIMIT)
        .lean<{ _id: Types.ObjectId; analysis?: CorrectableFields; corrections: Correction[] }[]>();
      return meals.flatMap(({ _id, analysis, corrections }) =>
        analysis ? [{ id: _id, analysis, corrections }] : [],
      );
    },
  };
}
