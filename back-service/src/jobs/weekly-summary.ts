import { Queue } from "bullmq";
import type { JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";

export const WEEKLY_SUMMARY_QUEUE = "weekly-summary";
/** El job del cron: calcula la semana anterior y encola un job por usuario. */
export const WEEKLY_FAN_OUT_JOB = "fan-out";
/** Un Wrapped: métricas, insights y upsert de un usuario y una semana. */
export const WEEKLY_SUMMARY_JOB = "summary";

// RF-12: los lunes a las 06:00. En v1 la hora es la de Montevideo (UTC-3) para todos.
export const WEEKLY_SUMMARY_SCHEDULER_ID = "weekly-summary-cron";
export const WEEKLY_SUMMARY_PATTERN = "0 6 * * 1";
export const WEEKLY_SUMMARY_TZ = "America/Montevideo";

/** Sin `week`, el fan-out procesa la semana anterior a hoy (lo que hace el cron). */
export interface WeeklyFanOutJob {
  week?: string;
}

export interface WeeklySummaryJob {
  userId: string;
  week: string;
}

export type WeeklyJobData = WeeklyFanOutJob | WeeklySummaryJob;

/** Las mismas que meal-analysis: 4 intentos con backoff exponencial. */
export const WEEKLY_SUMMARY_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
} satisfies JobsOptions;

/** Un fan-out repetido no duplica: BullMQ ignora un jobId que ya existe. No admite ":". */
export const weeklySummaryJobId = ({ userId, week }: WeeklySummaryJob) => `${userId}-${week}`;

export interface WeeklySummaryQueue {
  /** Registra el cron. Idempotente: con el mismo id, un reinicio actualiza y no duplica. */
  registerScheduler(): Promise<void>;
  /** Encola un fan-out ya, para una semana dada o la anterior. Lo usa `npm run wrapped`. */
  fanOutNow(week?: string): Promise<void>;
  /** Encola un job por usuario. Devuelve cuántos se pidieron encolar. */
  enqueueSummaries(jobs: WeeklySummaryJob[]): Promise<number>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface WeeklySummaryQueueOptions {
  redisUrl: string;
  logger: Logger;
  prefix?: string;
}

export function createWeeklySummaryQueue({
  redisUrl,
  logger,
  prefix,
}: WeeklySummaryQueueOptions): WeeklySummaryQueue {
  // La usa el Worker, no un request: puede esperar a que Redis vuelva.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<WeeklyJobData>(WEEKLY_SUMMARY_QUEUE, { connection, prefix });

  let down = false;
  queue.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("cola del Wrapped: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("cola del Wrapped: Redis disponible de nuevo");
    down = false;
  });

  return {
    async registerScheduler() {
      await queue.upsertJobScheduler(
        WEEKLY_SUMMARY_SCHEDULER_ID,
        { pattern: WEEKLY_SUMMARY_PATTERN, tz: WEEKLY_SUMMARY_TZ },
        { name: WEEKLY_FAN_OUT_JOB, data: {}, opts: WEEKLY_SUMMARY_JOB_OPTIONS },
      );
    },
    async fanOutNow(week) {
      await queue.add(WEEKLY_FAN_OUT_JOB, week ? { week } : {}, WEEKLY_SUMMARY_JOB_OPTIONS);
    },
    async enqueueSummaries(jobs) {
      if (jobs.length === 0) return 0;
      await queue.addBulk(
        jobs.map((data) => ({
          name: WEEKLY_SUMMARY_JOB,
          data,
          opts: { ...WEEKLY_SUMMARY_JOB_OPTIONS, jobId: weeklySummaryJobId(data) },
        })),
      );
      return jobs.length;
    },
    async ready() {
      await queue.waitUntilReady();
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
