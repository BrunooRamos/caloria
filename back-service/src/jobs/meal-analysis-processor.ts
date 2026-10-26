import { Types } from "mongoose";
import type { Logger } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import type { Meal } from "../models/Meal";
import type { MediaService } from "../services/media";
import type { MealAnalysisJob } from "./meal-analysis";

export interface MealAnalysisInput {
  meal: Meal;
  photo: Uint8Array;
  audio?: Uint8Array;
}

/** Analiza la comida y la deja en su estado final. Llega desde afuera (`createAnalyzeMeal`). */
export type AnalyzeMeal = (input: MealAnalysisInput, log: Logger) => Promise<void>;

/** Qué pasó con el job, para el log: `missing` y `skipped` terminan sin error y sin reintento. */
export type MealAnalysisOutcome = "analyzed" | "missing" | "skipped";

export type MealAnalysisProcessor = (
  job: MealAnalysisJob,
  log: Logger,
) => Promise<MealAnalysisOutcome>;

export interface MealAnalysisProcessorDeps {
  media: MediaService;
  analyze: AnalyzeMeal;
}

/** Lógica de cada job, sin BullMQ: los errores de Mongo o del bucket se propagan y BullMQ reintenta. */
export function createMealAnalysisProcessor({
  media,
  analyze,
}: MealAnalysisProcessorDeps): MealAnalysisProcessor {
  return async ({ mealId }, log) => {
    // Reintentar no va a hacer aparecer la comida: se termina el job sin error.
    const meal = Types.ObjectId.isValid(mealId) ? await MealModel.findById(mealId).lean() : null;
    if (!meal) {
      log.warn("la comida del job no existe, se descarta");
      return "missing";
    }
    // Un job repetido no pisa una comida que ya se analizó.
    if (meal.status !== "processing") {
      log.info("la comida ya no está en processing, se saltea", { status: meal.status });
      return "skipped";
    }

    const { photoKey, audioKey } = meal.media;
    const [photo, audio] = await Promise.all([
      media.download(photoKey),
      audioKey ? media.download(audioKey) : undefined,
    ]);
    await analyze({ meal, photo, ...(audio && { audio }) }, log);
    return "analyzed";
  };
}
