import { Worker } from "bullmq";
import type { Job } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { WEEKLY_FAN_OUT_JOB, WEEKLY_SUMMARY_JOB, WEEKLY_SUMMARY_QUEUE } from "./weekly-summary";
import type { WeeklyFanOutJob, WeeklyJobData, WeeklySummaryJob } from "./weekly-summary";
import type { WeeklyFanOut, WeeklySummaryProcessor } from "./weekly-summary-processor";

/** Lo que el handler lee del job de BullMQ; alcanza con esto para testearlo sin Redis. */
export type WeeklyJobRun = Pick<Job<WeeklyJobData>, "name" | "data" | "attemptsMade" | "opts">;

export interface WeeklySummaryHandlerDeps {
  fanOut: WeeklyFanOut;
  summary: WeeklySummaryProcessor;
  /** Se llama cuando un Wrapped agota los reintentos. */
  markFailed: (job: WeeklySummaryJob) => Promise<void>;
}

/** Reparte por nombre de job y loguea intento y duración, salga bien o mal. */
export function createWeeklySummaryHandler(
  { fanOut, summary, markFailed }: WeeklySummaryHandlerDeps,
  logger: Logger,
) {
  return async ({ name, data, attemptsMade, opts }: WeeklyJobRun) => {
    const attempt = attemptsMade + 1;
    const maxAttempts = opts.attempts ?? 1;
    const isSummary = name === WEEKLY_SUMMARY_JOB;
    if (!isSummary && name !== WEEKLY_FAN_OUT_JOB) {
      throw new Error(`Job desconocido en la cola ${WEEKLY_SUMMARY_QUEUE}: ${name}`);
    }
    const summaryJob = data as WeeklySummaryJob;
    const log = logger.child({
      job: name,
      ...(isSummary && { userId: summaryJob.userId, week: summaryJob.week }),
      attempt,
      maxAttempts,
    });
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    try {
      if (isSummary) {
        const outcome = await summary(summaryJob, log);
        log.info("job del Wrapped terminado", { outcome, durationMs: durationMs() });
      } else {
        await fanOut(data as WeeklyFanOutJob, log);
      }
    } catch (err) {
      const willRetry = attempt < maxAttempts;
      log.error("job del Wrapped falló", {
        durationMs: durationMs(),
        willRetry,
        err: serializeError(err, { stack: true }),
      });
      if (isSummary && !willRetry) {
        try {
          await markFailed(summaryJob);
          log.warn("Wrapped en failed: se agotaron los reintentos");
        } catch (markErr) {
          log.error("no se pudo dejar el Wrapped en failed", { err: serializeError(markErr) });
        }
      }
      throw err;
    }
  };
}

export interface WeeklySummaryWorker {
  ready(): Promise<void>;
  /** Deja de tomar jobs y espera a que terminen los que están corriendo. */
  close(): Promise<void>;
}

export interface WeeklySummaryWorkerOptions extends WeeklySummaryHandlerDeps {
  redisUrl: string;
  concurrency: number;
  logger: Logger;
  prefix?: string;
}

export function createWeeklySummaryWorker({
  redisUrl,
  concurrency,
  logger,
  prefix,
  ...deps
}: WeeklySummaryWorkerOptions): WeeklySummaryWorker {
  // Comandos bloqueantes: BullMQ exige maxRetriesPerRequest null y una conexión propia.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<WeeklyJobData>(
    WEEKLY_SUMMARY_QUEUE,
    createWeeklySummaryHandler(deps, logger),
    { connection, concurrency, prefix },
  );

  let down = false;
  worker.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("worker del Wrapped: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("worker del Wrapped: Redis disponible de nuevo");
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
