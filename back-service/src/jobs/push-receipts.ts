import { Queue } from "bullmq";
import type { JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger, NotificationType } from "@caloria/shared";
import type { PushReceiptRef } from "../services/push";

export const PUSH_RECEIPTS_QUEUE = "push-receipts";
export const PUSH_RECEIPTS_JOB = "check";

/** Los receipts de un aviso. `type` va solo para el log. */
export interface PushReceiptsJob {
  userId: string;
  type: NotificationType;
  receipts: PushReceiptRef[];
}

// Expo recomienda consultar los receipts unos 15 min después de mandar, y los borra a las 24 h.
export const PUSH_RECEIPTS_DELAY_MS = 15 * 60 * 1000;

export const PUSH_RECEIPTS_JOB_OPTIONS = {
  delay: PUSH_RECEIPTS_DELAY_MS,
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
} satisfies JobsOptions;

const ENQUEUE_TIMEOUT_MS = 2_000;

export interface PushReceiptsQueue {
  enqueue(job: PushReceiptsJob): Promise<void>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface PushReceiptsQueueOptions {
  redisUrl: string;
  logger: Logger;
  prefix?: string;
}

export function createPushReceiptsQueue({
  redisUrl,
  logger,
  prefix,
}: PushReceiptsQueueOptions): PushReceiptsQueue {
  const connection = new IORedis(redisUrl, {
    enableOfflineQueue: false,
    commandTimeout: ENQUEUE_TIMEOUT_MS,
  });

  const queue = new Queue<PushReceiptsJob>(PUSH_RECEIPTS_QUEUE, { connection, prefix });

  let down = false;
  queue.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("cola de receipts: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("cola de receipts: Redis disponible de nuevo");
    down = false;
  });

  return {
    async enqueue(job) {
      if (connection.status !== "ready") {
        throw new Error(`Redis no disponible (conexión en estado ${connection.status})`);
      }
      await queue.add(PUSH_RECEIPTS_JOB, job, PUSH_RECEIPTS_JOB_OPTIONS);
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
