import { Types } from "mongoose";
import type { Logger } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import type { Meal } from "../models/Meal";
import { UserModel } from "../models/User";
import type { MediaService } from "../services/media";
import { refundMealQuota } from "../services/quota";
import type { MealAnalysisJob } from "./meal-analysis";

export interface MealAnalysisInput {
  meal: Meal;
  photo: Uint8Array;
  audio?: Uint8Array;
}

/** Analiza la comida y la deja en su estado final. Llega desde afuera (`createAnalyzeMeal`). */
export type AnalyzeMeal = (input: MealAnalysisInput, log: Logger) => Promise<void>;

/**
 * Qué pasó con el job, para el log. Salvo `analyzed`, terminan sin error y sin reintento:
 * `account-deleted` es una comida que quedó de una cuenta borrada (la limpieza la borra).
 */
export type MealAnalysisOutcome = "analyzed" | "missing" | "skipped" | "account-deleted";

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
    // Cuenta borrada mientras la comida estaba en la cola: ni se baja la foto ni se le
    // manda a la IA. La comida y su media las borra la limpieza del borrado.
    if (!(await UserModel.exists({ _id: meal.userId }))) {
      log.warn("la cuenta de la comida ya no existe, se descarta");
      return "account-deleted";
    }
    // Un job repetido no pisa una comida que ya se analizó.
    if (meal.status !== "processing") {
      log.info("la comida ya no está en processing, se saltea", { status: meal.status });
      // Si un intento anterior la dejó failed pero no llegó a devolver el cupo, se devuelve acá.
      // Es idempotente: si ya se devolvió, no hace nada.
      if (meal.status === "failed" && (await refundMealQuota(meal._id))) {
        log.info("cupo de la comida failed", { refunded: true });
      }
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
