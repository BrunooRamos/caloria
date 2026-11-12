import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import type { Meal } from "../models/Meal";
import type { AiUsageRecorder } from "../services/ai-usage";
import type { DishIdentifier, IdentifyResult } from "../services/dish-identifier";
import type { SimilarMeal, SimilarMealsFinder } from "../services/similar-meals";
import type { VisionImage } from "../services/vision-image";

export interface SimilarMealsLookupDeps {
  identifier: DishIdentifier;
  similarMeals: SimilarMealsFinder;
  aiUsage?: AiUsageRecorder;
}

export interface SimilarMealsLookupInput {
  meal: Pick<Meal, "_id" | "userId" | "note">;
  image: Promise<VisionImage>;
  /** La transcripción del job. No rechaza: si falla, el job lanza por su lado y acá llega undefined. */
  transcript: Promise<string | undefined>;
}

const elapsed = (started: number) => Math.round(performance.now() - started);

/**
 * Comidas corregidas parecidas para pasarle a la IA como contexto. Arranca junto con la
 * transcripción: si el usuario tiene comidas corregidas, identifica el plato con una llamada corta
 * mientras se transcribe, y después busca con el plato, los ingredientes, la nota y la
 * transcripción. Nunca lanza: el compounding mejora el análisis, pero no puede hacerlo fallar.
 */
export async function lookupSimilarMeals(
  { meal, image, transcript }: SimilarMealsLookupInput,
  { identifier, similarMeals, aiUsage }: SimilarMealsLookupDeps,
  log: Logger,
): Promise<SimilarMeal[]> {
  try {
    if (!(await similarMeals.hasCandidates(meal.userId))) {
      log.info("comidas similares", { candidates: false, found: 0 });
      return [];
    }
  } catch (err) {
    log.warn("no se pudo buscar comidas similares; se analiza sin contexto", {
      err: serializeError(err),
    });
    return [];
  }

  // Si la identificación falla o tarda, se busca igual con la nota y la transcripción.
  const identifyStarted = performance.now();
  let identified: IdentifyResult | undefined;
  try {
    identified = await identifier.identify(await image);
    await aiUsage?.record(
      {
        kind: "identify",
        model: identified.model,
        userId: meal.userId,
        mealId: meal._id,
        ...(identified.usage && { usage: identified.usage }),
      },
      log,
    );
  } catch (err) {
    log.warn("no se pudo identificar el plato; se busca con la nota y la transcripción", {
      durationMs: elapsed(identifyStarted),
      err: serializeError(err),
    });
  }
  const identifyMs = elapsed(identifyStarted);
  const spoken = await transcript.catch(() => undefined);

  const searchStarted = performance.now();
  try {
    const found = await similarMeals.find({
      userId: meal.userId,
      excludeMealId: meal._id,
      terms: [identified?.dish ?? "", ...(identified?.items ?? []), meal.note ?? "", spoken ?? ""],
    });
    // Ni el plato identificado ni el texto de la persona van al log: solo ids y tiempos.
    log.info("comidas similares", {
      candidates: true,
      identified: Boolean(identified?.dish),
      ...(identified && {
        identifyModel: identified.model,
        identifyPromptVersion: identified.promptVersion,
        identifyUsage: identified.usage,
      }),
      identifyMs,
      searchMs: elapsed(searchStarted),
      found: found.length,
      contextMealIds: found.map(({ id }) => id.toString()),
    });
    return found;
  } catch (err) {
    log.warn("no se pudo buscar comidas similares; se analiza sin contexto", {
      searchMs: elapsed(searchStarted),
      err: serializeError(err),
    });
    return [];
  }
}
