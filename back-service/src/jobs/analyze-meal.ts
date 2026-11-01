import type { Logger, MealErrorCode } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import type { Meal } from "../models/Meal";
import type { DishIdentifier } from "../services/dish-identifier";
import type { SimilarMealsFinder } from "../services/similar-meals";
import type { TranscriptionService } from "../services/transcription";
import { toVisionImage } from "../services/vision-image";
import { InvalidVisionResponseError } from "../services/vision";
import type { VisionService } from "../services/vision";
import type { AnalyzeMeal } from "./meal-analysis-processor";
import { lookupSimilarMeals } from "./similar-meals-lookup";

/** `error.code` de una meal cuya foto no es comida. Termina sin reintento y no consume cupo. */
export const NOT_FOOD = "NOT_FOOD" satisfies MealErrorCode;

export interface AnalyzeMealDeps {
  vision: VisionService;
  transcriber: TranscriptionService;
  /** Identifica el plato para buscar comidas corregidas parecidas. */
  identifier: DishIdentifier;
  similarMeals: SimilarMealsFinder;
}

/** `saved: false` si la meal dejó de estar en processing mientras se transcribía. */
type TranscriptResult = { saved: boolean; transcript?: string };

/**
 * Transcribe el audio y guarda el texto en la meal. Si un intento anterior ya lo guardó, lo
 * reusa: no se paga dos veces. Si falla, lanza y BullMQ reintenta.
 */
async function transcribeOnce(
  meal: Meal,
  audio: Uint8Array | undefined,
  transcriber: TranscriptionService,
  log: Logger,
): Promise<TranscriptResult> {
  if (meal.transcript) {
    log.info("transcripción del audio", { reused: true, chars: meal.transcript.length });
    return { saved: true, transcript: meal.transcript };
  }
  if (!audio) return { saved: true };

  const started = performance.now();
  const transcript = await transcriber.transcribe(audio);
  // Ni el audio ni el texto van al log: solo el largo.
  log.info("transcripción del audio", {
    model: transcriber.model,
    durationMs: Math.round(performance.now() - started),
    reused: false,
    chars: transcript.length,
  });
  // Vacía o solo ruido: como si no hubiera audio.
  if (!transcript) return { saved: true };

  // Solo si sigue en processing: un job repetido no pisa una meal que ya cambió.
  const { matchedCount } = await MealModel.updateOne(
    { _id: meal._id, status: "processing" },
    { $set: { transcript } },
    { runValidators: true },
  );
  return { saved: matchedCount === 1, transcript };
}

/**
 * Analiza la foto (más la transcripción, la nota y las comidas corregidas parecidas, si hay) con
 * la IA y deja la meal en `ready` o en `failed` (NOT_FOOD). Si la transcripción falla o la
 * respuesta no pasa zod, lanza: BullMQ reintenta y la meal sigue en processing.
 */
export function createAnalyzeMeal({
  vision,
  transcriber,
  identifier,
  similarMeals,
}: AnalyzeMealDeps): AnalyzeMeal {
  return async ({ meal, photo, audio }, log) => {
    // La transcripción corre en paralelo con la conversión de la foto y con la búsqueda de
    // comidas similares (RNF-01). allSettled espera a las dos primeras: si la foto falla, la
    // transcripción igual queda guardada para el reintento. La búsqueda nunca lanza.
    const image = toVisionImage(photo);
    const transcribed = transcribeOnce(meal, audio, transcriber, log);
    // El rechazo de la transcripción lo maneja el job: a la búsqueda le llega undefined. El handler
    // va acá y no adentro, para que el rechazo nunca quede sin manejar mientras se identifica.
    const spoken = transcribed.then(
      (result) => result.transcript,
      () => undefined,
    );
    const similar = lookupSimilarMeals(
      { meal, image, transcript: spoken },
      { identifier, similarMeals },
      log,
    );
    const [imageResult, transcriptResult] = await Promise.allSettled([image, transcribed]);
    if (transcriptResult.status === "rejected") throw transcriptResult.reason;
    if (imageResult.status === "rejected") throw imageResult.reason;
    const { saved, transcript } = transcriptResult.value;
    if (!saved) {
      log.info("la comida cambió de estado durante la transcripción, no se pisa");
      return;
    }
    const note = meal.note?.trim() || undefined;
    const similarMealsFound = await similar;
    const contextMealIds = similarMealsFound.map(({ id }) => id);

    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    let result;
    try {
      result = await vision.analyze({
        image: imageResult.value,
        ...(transcript && { transcript }),
        ...(note && { note }),
        ...(similarMealsFound.length > 0 && { similarMeals: similarMealsFound }),
      });
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
      ? { status: "ready", analysis: { ...result.analysis, promptVersion, model, contextMealIds } }
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
      // Si llevó contexto del usuario; el texto no va al log.
      withTranscript: Boolean(transcript),
      withNote: Boolean(note),
      contextMeals: contextMealIds.length,
      saved: matchedCount === 1,
    });
    if (matchedCount === 0) {
      log.info("la comida cambió de estado durante el análisis, no se pisa");
    }
  };
}
