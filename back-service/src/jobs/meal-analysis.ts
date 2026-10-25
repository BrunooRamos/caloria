import { Queue } from "bullmq";
import type { JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";

export const MEAL_ANALYSIS_QUEUE = "meal-analysis";
export const MEAL_ANALYSIS_JOB = "analyze";

export interface MealAnalysisJob {
  mealId: string;
  requestId: string;
}

export const MEAL_ANALYSIS_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
} satisfies JobsOptions;

const ENQUEUE_TIMEOUT_MS = 2_000;

export interface MealAnalysisQueue {
  enqueue(job: MealAnalysisJob): Promise<void>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface MealAnalysisQueueOptions {
  redisUrl: string;
  logger: Logger;
  prefix?: string;
}

export function createMealAnalysisQueue({
  redisUrl,
  logger,
  prefix,
}: MealAnalysisQueueOptions): MealAnalysisQueue {
  const connection = new IORedis(redisUrl, {
    enableOfflineQueue: false,
    commandTimeout: ENQUEUE_TIMEOUT_MS,
  });

  const queue = new Queue<MealAnalysisJob>(MEAL_ANALYSIS_QUEUE, { connection, prefix });

  let down = false;
  queue.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("cola de análisis: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("cola de análisis: Redis disponible de nuevo");
    down = false;
  });

  return {
    async enqueue(job) {
      if (connection.status !== "ready") {
        throw new Error(`Redis no disponible (conexión en estado ${connection.status})`);
      }
      await queue.add(MEAL_ANALYSIS_JOB, job, { ...MEAL_ANALYSIS_JOB_OPTIONS, jobId: job.mealId });
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
