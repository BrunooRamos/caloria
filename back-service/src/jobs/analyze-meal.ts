import { serializeError } from "@caloria/shared";
import type { Logger, MealErrorCode } from "@caloria/shared";
import { createAiUsageRecorder } from "../services/ai-usage";
import type { AiUsageRecorder } from "../services/ai-usage";
import { mp4DurationSeconds } from "../services/audio-duration";
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
  /** Registra el costo de cada llamada a la IA (RNF-07). */
  aiUsage?: AiUsageRecorder;
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
  aiUsage: AiUsageRecorder,
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
  // Se cobra por minuto de audio: la duración sale del contenedor M4A.
  const buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  await aiUsage.record(
    {
      kind: "transcription",
      model: transcriber.model,
      userId: meal.userId,
      mealId: meal._id,
      audioSeconds: mp4DurationSeconds(buffer),
    },
    log,
  );
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
  meal: Pick<Meal, "_id" | "userId">,
  { dish, items, kcal, macros }: FoodAnalysis,
  commenter: CommentService,
  aiUsage: AiUsageRecorder,
  log: Logger,
): Promise<Meal["comment"]> {
  const userId = meal.userId;
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
    await aiUsage.record(
      { kind: "comment", model, userId, mealId: meal._id, ...(usage && { usage }) },
      log,
    );
    if (isBlockedComment(text)) {
      done("blocked", { tone, usage, chars: text.length });
      return undefined;
    }
    done("ok", { tone, usage, chars: text.length });
    return { tone, text };
  } catch (err) {
    if (err instanceof InvalidCommentResponseError) {
      // Una respuesta inválida se paga igual.
      await aiUsage.record(
        {
          kind: "comment",
          model,
          userId,
          mealId: meal._id,
          ...(err.usage && { usage: err.usage }),
        },
        log,
      );
      done("invalid", { tone, usage: err.usage, issues: err.issues });
    } else {
      done("failed", { tone, err: serializeError(err) });
    }
    return undefined;
  }
}

type MealUpdate = { status: "ready" | "failed" } & Partial<
  Pick<Meal, "analysis" | "comment" | "transcript" | "error" | "cachedFrom">
>;

/** Comida anterior del usuario con la misma foto, audio y nota, ya analizada. */
type CachedSource = Pick<Meal, "_id" | "status" | "analysis" | "comment" | "transcript">;

/**
 * Busca un análisis ya hecho con exactamente la misma entrada (cache por hash, RNF-07). Solo del
 * mismo usuario: el análisis puede llevar contexto de sus comidas corregidas y el comentario, su
 * tono. Sirve uno ready o uno NOT_FOOD; los failed por otro motivo no dicen nada de la foto.
 */
async function findCachedAnalysis(meal: Meal): Promise<CachedSource | null> {
  if (!meal.inputHash) return null;
  return MealModel.findOne(
    {
      userId: meal.userId,
      inputHash: meal.inputHash,
      _id: { $ne: meal._id },
      $or: [
        { status: "ready", analysis: { $exists: true } },
        { status: "failed", "error.code": NOT_FOOD },
      ],
    },
    { status: 1, analysis: 1, comment: 1, transcript: 1 },
  )
    .sort({ capturedAt: -1 })
    .lean<CachedSource>();
}

/**
 * Analiza la foto (más la transcripción, la nota y las comidas corregidas parecidas, si hay) con
 * la IA y deja la meal en `ready` (con el comentario, si el usuario tiene un tono activo) o en
 * `failed` (NOT_FOOD). Si el mismo usuario ya mandó exactamente la misma foto, audio y nota, copia
 * ese análisis sin llamar a la IA. Si la transcripción falla o la respuesta no pasa zod, lanza:
 * BullMQ reintenta y la meal sigue en processing. Si falla el comentario, no.
 */
export function createAnalyzeMeal({
  vision,
  transcriber,
  commenter,
  identifier,
  similarMeals,
  notifications,
  aiUsage = createAiUsageRecorder(),
}: AnalyzeMealDeps): AnalyzeMeal {
  /** Guarda el resultado si la meal sigue en processing, devuelve el cupo si es NOT_FOOD y avisa si quedó ready. */
  async function finish(meal: Meal, update: MealUpdate, log: Logger): Promise<boolean> {
    // Solo si sigue en processing: un job repetido no pisa una meal que ya cambió.
    const { matchedCount } = await MealModel.updateOne(
      { _id: meal._id, status: "processing" },
      { $set: update },
      { runValidators: true },
    );
    if (matchedCount === 0) {
      log.info("la comida cambió de estado durante el análisis, no se pisa");
      return false;
    }
    // Un análisis que termina en failed no consume cupo. Si esto lanza, BullMQ reintenta
    // y el processor vuelve a intentar la devolución al ver la comida en failed; es idempotente.
    if (update.status === "failed") {
      const refunded = await refundMealQuota(meal._id);
      log.info("cupo de la comida failed", { refunded });
      return true;
    }
    // Solo si este job la dejó en ready: un job repetido no avisa dos veces. NOT_FOOD no avisa
    // acá. notify no lanza: si el push falla, la meal ya está ready y el job termina bien.
    await notifications.notify(
      meal.userId.toString(),
      { type: "analysisReady", mealId: meal._id.toString() },
      log,
    );
    return true;
  }

  /** Copia el análisis de `source`. El comentario se reusa si el tono sigue siendo el mismo. */
  async function reuse(meal: Meal, source: CachedSource, log: Logger): Promise<void> {
    let update: MealUpdate;
    let commentReused = false;
    if (source.status === "ready" && source.analysis) {
      const user = await UserModel.findById(meal.userId, { tone: 1 }).lean<Pick<User, "tone">>();
      let comment: Meal["comment"];
      if (source.comment && source.comment.tone === user?.tone) {
        comment = source.comment;
        commentReused = true;
      } else {
        comment = await commentOnce(meal, source.analysis, commenter, aiUsage, log);
      }
      update = {
        status: "ready",
        analysis: source.analysis,
        cachedFrom: source._id,
        ...(source.transcript && { transcript: source.transcript }),
        ...(comment && { comment }),
      };
    } else {
      update = { status: "failed", error: { code: NOT_FOOD }, cachedFrom: source._id };
    }
    const saved = await finish(meal, update, log);
    log.info("análisis de la IA", {
      cached: true,
      cachedFrom: source._id.toString(),
      result: update.status === "ready" ? "ready" : NOT_FOOD,
      commentReused,
      saved,
    });
  }

  return async ({ meal, photo, audio }, log) => {
    // Misma foto, audio y nota que una comida anterior: no se le pregunta de nuevo a la IA.
    const source = await findCachedAnalysis(meal);
    if (source) {
      await reuse(meal, source, log);
      return;
    }

    // La transcripción corre en paralelo con la conversión de la foto y con la búsqueda de
    // comidas similares (RNF-01). allSettled espera a las dos primeras: si la foto falla, la
    // transcripción igual queda guardada para el reintento. La búsqueda nunca lanza.
    const image = toVisionImage(photo);
    const transcribed = transcribeOnce(meal, audio, transcriber, aiUsage, log);
    // El rechazo de la transcripción lo maneja el job: a la búsqueda le llega undefined. El handler
    // va acá y no adentro, para que el rechazo nunca quede sin manejar mientras se identifica.
    const spoken = transcribed.then(
      (result) => result.transcript,
      () => undefined,
    );
    const similar = lookupSimilarMeals(
      { meal, image, transcript: spoken },
      { identifier, similarMeals, aiUsage },
      log,
    );
    const [imageResult, transcriptResult] = await Promise.allSettled([image, transcribed]);
    if (transcriptResult.status === "rejected") throw transcriptResult.reason;
    if (imageResult.status === "rejected") throw imageResult.reason;
    const { saved: transcriptSaved, transcript } = transcriptResult.value;
    if (!transcriptSaved) {
      log.info("la comida cambió de estado durante la transcripción, no se pisa");
      return;
    }
    const note = meal.note?.trim() || undefined;
    const similarMealsFound = await similar;
    const contextMealIds = similarMealsFound.map(({ id }) => id);

    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    const ids = { userId: meal.userId, mealId: meal._id };
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
        // Una respuesta inválida se paga igual.
        await aiUsage.record(
          {
            kind: "analysis",
            model: err.info.model,
            ...ids,
            ...(err.info.usage && { usage: err.info.usage }),
          },
          log,
        );
      }
      throw err;
    }
    const elapsedMs = durationMs();

    const { model, promptVersion } = result;
    await aiUsage.record(
      { kind: "analysis", model, ...ids, ...(result.usage && { usage: result.usage }) },
      log,
    );
    let update: MealUpdate;
    if (result.isFood) {
      const comment = await commentOnce(meal, result.analysis, commenter, aiUsage, log);
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

    const saved = await finish(meal, update, log);
    log.info("análisis de la IA", {
      model,
      promptVersion,
      durationMs: elapsedMs,
      // Tokens consumidos; la clave no puede contener "token" porque el logger la redacta.
      usage: result.usage,
      result: result.isFood ? "ready" : NOT_FOOD,
      cached: false,
      // Si llevó contexto del usuario; el texto no va al log.
      withTranscript: Boolean(transcript),
      withNote: Boolean(note),
      contextMeals: contextMealIds.length,
      saved,
    });
  };
}
