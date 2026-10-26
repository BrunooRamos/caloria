import { MealModel } from "../models/Meal";
import { toVisionImage } from "../services/vision-image";
import { InvalidVisionResponseError } from "../services/vision";
import type { VisionService } from "../services/vision";
import type { AnalyzeMeal } from "./meal-analysis-processor";

/** `error.code` de una meal cuya foto no es comida. Termina sin reintento y no consume cupo. */
export const NOT_FOOD = "NOT_FOOD";

export interface AnalyzeMealDeps {
  vision: VisionService;
}

/**
 * Analiza la foto con la IA y deja la meal en `ready` o en `failed` (NOT_FOOD). Si la respuesta
 * no pasa zod, lanza: BullMQ reintenta y la meal sigue en processing.
 */
export function createAnalyzeMeal({ vision }: AnalyzeMealDeps): AnalyzeMeal {
  return async ({ meal, photo }, log) => {
    const image = await toVisionImage(photo);

    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    let result;
    try {
      result = await vision.analyze(image);
    } catch (err) {
      // Solo los issues de zod: ni la respuesta cruda, ni la foto, ni la nota.
      if (err instanceof InvalidVisionResponseError) {
        log.warn("la IA devolvió un análisis inválido", {
          model: err.info.model,
          promptVersion: err.info.promptVersion,
          durationMs: durationMs(),
          usage: err.info.usage,
          issues: err.issues,
        });
      }
      throw err;
    }
    const elapsedMs = durationMs();

    const { model, promptVersion } = result;
    const update = result.isFood
      ? { status: "ready", analysis: { ...result.analysis, promptVersion, model } }
      : { status: "failed", error: { code: NOT_FOOD } };
    // Solo si sigue en processing: un job repetido no pisa una meal que ya cambió.
    const { matchedCount } = await MealModel.updateOne(
      { _id: meal._id, status: "processing" },
      { $set: update },
      { runValidators: true },
    );

    log.info("análisis de la IA", {
      model,
      promptVersion,
      durationMs: elapsedMs,
      // Tokens consumidos; la clave no puede contener "token" porque el logger la redacta.
      usage: result.usage,
      result: result.isFood ? "ready" : NOT_FOOD,
      saved: matchedCount === 1,
    });
    if (matchedCount === 0) {
      log.info("la comida cambió de estado durante el análisis, no se pisa");
    }
  };
}
