import type { Types } from "mongoose";
import { serializeError } from "@caloria/shared";
import type { Logger, MealErrorCode } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import type { Meal } from "../models/Meal";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { InvalidCommentResponseError } from "../services/comment";
import type { CommentService } from "../services/comment";
import { isBlockedComment } from "../services/comment-safety";
import type { DishIdentifier } from "../services/dish-identifier";
import type { NotificationService } from "../services/notifications";
import type { SimilarMealsFinder } from "../services/similar-meals";
import type { TranscriptionService } from "../services/transcription";
import { refundMealQuota } from "../services/quota";
import { toVisionImage } from "../services/vision-image";
import { InvalidVisionResponseError } from "../services/vision";
import type { FoodAnalysis, VisionService } from "../services/vision";
import type { AnalyzeMeal } from "./meal-analysis-processor";
import { lookupSimilarMeals } from "./similar-meals-lookup";

/** `error.code` de una meal cuya foto no es comida. Termina sin reintento y no consume cupo. */
export const NOT_FOOD = "NOT_FOOD" satisfies MealErrorCode;

export interface AnalyzeMealDeps {
  vision: VisionService;
  transcriber: TranscriptionService;
  commenter: CommentService;
  /** Identifica el plato para buscar comidas corregidas parecidas. */
  identifier: DishIdentifier;
  similarMeals: SimilarMealsFinder;
  notifications: Pick<NotificationService, "notify">;
}

/** Qué pasó con el comentario, para el log. */
export type CommentOutcome = "ok" | "off" | "not_food" | "invalid" | "failed" | "blocked";

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
 * Genera el comentario en el tono del dueño de la meal. Nunca lanza: si falla, la meal queda
 * ready sin comentario y no se reintenta (no se vuelve a pagar la visión por un comentario).
 */
async function commentOnce(
  userId: Types.ObjectId,
  { dish, items, kcal, macros }: FoodAnalysis,
  commenter: CommentService,
  log: Logger,
): Promise<Meal["comment"]> {
  const { model, promptVersion } = commenter;
  const started = performance.now();
  // El texto del comentario no va al log: solo el largo.
  const done = (result: CommentOutcome, fields: Record<string, unknown> = {}) => {
    const level = result === "ok" ? "info" : "warn";
    log[level]("comentario de la IA", {
      ...fields,
      model,
      promptVersion,
      durationMs: Math.round(performance.now() - started),
      result,
    });
  };

  let tone: User["tone"] | undefined;
  try {
    // Solo el tono: del perfil no se lee nada más.
    const user = await UserModel.findById(userId, { tone: 1 }).lean<Pick<User, "tone">>();
    tone = user?.tone;
    if (!tone || tone === "off") {
      log.info("comentario de la IA", { tone: tone ?? null, result: "off" });
      return undefined;
    }
    const { text, usage } = await commenter.comment({
      tone,
      analysis: { dish, items, kcal, macros },
    });
    if (isBlockedComment(text)) {
      done("blocked", { tone, usage, chars: text.length });
      return undefined;
    }
    done("ok", { tone, usage, chars: text.length });
    return { tone, text };
  } catch (err) {
    if (err instanceof InvalidCommentResponseError) {
      done("invalid", { tone, usage: err.usage, issues: err.issues });
    } else {
      done("failed", { tone, err: serializeError(err) });
    }
    return undefined;
  }
}

/**
 * Analiza la foto (más la transcripción, la nota y las comidas corregidas parecidas, si hay) con
 * la IA y deja la meal en `ready` (con el comentario, si el usuario tiene un tono activo) o en
 * `failed` (NOT_FOOD). Si la transcripción falla o la respuesta no pasa zod, lanza: BullMQ
 * reintenta y la meal sigue en processing. Si falla el comentario, no.
 */
export function createAnalyzeMeal({
  vision,
  transcriber,
  commenter,
  identifier,
  similarMeals,
  notifications,
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
    let update;
    if (result.isFood) {
      const comment = await commentOnce(meal.userId, result.analysis, commenter, log);
      update = {
        status: "ready",
        analysis: { ...result.analysis, promptVersion, model, contextMealIds },
        ...(comment && { comment }),
      };
    } else {
      // Solo se comenta lo que es comida.
      log.info("comentario de la IA", { result: "not_food" });
      update = { status: "failed", error: { code: NOT_FOOD } };
    }
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
      return;
    }
    // Un análisis que termina en failed no consume cupo. Si esto lanza, BullMQ reintenta
    // y el processor vuelve a intentar la devolución al ver la comida en failed; es idempotente.
    if (!result.isFood) {
      const refunded = await refundMealQuota(meal._id);
      log.info("cupo de la comida failed", { refunded });
    }
    // Solo si este job la dejó en ready: un job repetido no avisa dos veces. NOT_FOOD no avisa
    // acá. notify no lanza: si el push falla, la meal ya está ready y el job termina bien.
    if (result.isFood) {
      await notifications.notify(
        meal.userId.toString(),
        { type: "analysisReady", mealId: meal._id.toString() },
        log,
      );
    }
  };
}
