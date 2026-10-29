import { Worker } from "bullmq";
import type { Job } from "bullmq";
import IORedis from "ioredis";
import { Types } from "mongoose";
import { serializeError } from "@caloria/shared";
import type { Logger, MealErrorCode } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import { MEAL_ANALYSIS_QUEUE } from "./meal-analysis";
import type { MealAnalysisJob } from "./meal-analysis";
import type { MealAnalysisProcessor } from "./meal-analysis-processor";

/** `error.code` de una meal que agotó los reintentos del análisis (RNF-02). */
export const ANALYSIS_FAILED = "ANALYSIS_FAILED" satisfies MealErrorCode;

/** Lo que el handler lee del job de BullMQ; alcanza con esto para testearlo sin Redis. */
export type MealAnalysisJobRun = Pick<Job<MealAnalysisJob>, "data" | "attemptsMade" | "opts">;

/**
 * Guarda en la meal cuántos intentos fallaron y, si fue el último, la deja en `failed` con
 * `ANALYSIS_FAILED` (RNF-02). Solo si sigue en processing: no pisa una meal que ya cambió.
 * La media no se toca: queda en el bucket. Si Mongo falla, se loguea y no tapa el error del job.
 */
async function recordFailedAttempt(mealId: string, attempt: number, final: boolean, log: Logger) {
  if (!Types.ObjectId.isValid(mealId)) return;
  try {
    const { matchedCount } = await MealModel.updateOne(
      { _id: mealId, status: "processing" },
      {
        $set: {
          attempts: attempt,
          ...(final && { status: "failed", error: { code: ANALYSIS_FAILED } }),
        },
      },
      { runValidators: true },
    );
    if (final && matchedCount === 1) {
      log.warn("se agotaron los reintentos: la comida queda en failed", {
        errorCode: ANALYSIS_FAILED,
      });
    }
  } catch (err) {
    log.error("no se pudo registrar el intento fallido en la comida", {
      final,
      err: serializeError(err, { stack: true }),
    });
  }
}

/**
 * Envuelve el processor con los logs de cada job: ids, intento y duración, salga bien o mal.
 * Si falla, registra el intento en la meal y vuelve a tirar el error para que BullMQ reintente
 * (o marque el job como fallido en el último intento).
 */
export function createMealAnalysisHandler(processor: MealAnalysisProcessor, logger: Logger) {
  return async ({ data, attemptsMade, opts }: MealAnalysisJobRun) => {
    const attempt = attemptsMade + 1;
    const maxAttempts = opts.attempts ?? 1;
    const log = logger.child({
      mealId: data.mealId,
      requestId: data.requestId,
      attempt,
      maxAttempts,
    });
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    try {
      const outcome = await processor(data, log);
      log.info("job de análisis terminado", { outcome, durationMs: durationMs() });
    } catch (err) {
      const willRetry = attempt < maxAttempts;
      log.error("job de análisis falló", {
        durationMs: durationMs(),
        willRetry,
        err: serializeError(err, { stack: true }),
      });
      await recordFailedAttempt(data.mealId, attempt, !willRetry, log);
      throw err;
    }
  };
}

export interface MealAnalysisWorker {
  ready(): Promise<void>;
  /** Deja de tomar jobs y espera a que terminen los que están corriendo. */
  close(): Promise<void>;
}

export interface MealAnalysisWorkerOptions {
  redisUrl: string;
  concurrency: number;
  processor: MealAnalysisProcessor;
  logger: Logger;
  prefix?: string;
}

export function createMealAnalysisWorker({
  redisUrl,
  concurrency,
  processor,
  logger,
  prefix,
}: MealAnalysisWorkerOptions): MealAnalysisWorker {
  // El Worker usa comandos bloqueantes: BullMQ exige maxRetriesPerRequest null. Por eso no se
  // comparte la conexión de la cola, que está pensada para fallar rápido.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<MealAnalysisJob>(
    MEAL_ANALYSIS_QUEUE,
    createMealAnalysisHandler(processor, logger),
    { connection, concurrency, prefix },
  );

  // Con Redis caído el Worker emite un error por cada reintento: se loguea solo el primero.
  let down = false;
  worker.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("worker de análisis: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("worker de análisis: Redis disponible de nuevo");
    down = false;
  });

  return {
    async ready() {
      await worker.waitUntilReady();
    },
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
