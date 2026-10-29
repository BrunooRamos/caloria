import { Worker } from "bullmq";
import type { Job } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { removePushTokens } from "../services/notifications";
import type { PushService } from "../services/push";
import { PUSH_RECEIPTS_QUEUE } from "./push-receipts";
import type { PushReceiptsJob } from "./push-receipts";

export interface PushReceiptsOutcome {
  ok: number;
  failed: number;
  pending: number;
  removed: number;
}

export type PushReceiptsProcessor = (job: PushReceiptsJob) => Promise<PushReceiptsOutcome>;

/**
 * Consulta los receipts y saca del usuario los tokens con DeviceNotRegistered. Si falla la
 * request a Expo o Mongo, lanza y BullMQ reintenta. Un receipt que todavía no está no se reintenta.
 */
export function createPushReceiptsProcessor(push: PushService): PushReceiptsProcessor {
  return async ({ userId, receipts }) => {
    const { ok, failed, pending, invalid } = await push.checkReceipts(receipts);
    const removed = await removePushTokens(userId, invalid);
    return { ok, failed, pending, removed };
  };
}

/** Lo que el handler lee del job de BullMQ; alcanza con esto para testearlo sin Redis. */
export type PushReceiptsJobRun = Pick<Job<PushReceiptsJob>, "data" | "attemptsMade" | "opts">;

/** Envuelve el processor con los logs: usuario, tipo, conteos y duración. Nunca los tokens. */
export function createPushReceiptsHandler(processor: PushReceiptsProcessor, logger: Logger) {
  return async ({ data, attemptsMade, opts }: PushReceiptsJobRun) => {
    const attempt = attemptsMade + 1;
    const maxAttempts = opts.attempts ?? 1;
    const log = logger.child({ userId: data.userId, type: data.type, attempt, maxAttempts });
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    try {
      const outcome = await processor(data);
      log.info("receipts de push consultados", {
        devices: data.receipts.length,
        ...outcome,
        durationMs: durationMs(),
      });
    } catch (err) {
      log.error("consulta de receipts de push falló", {
        devices: data.receipts.length,
        durationMs: durationMs(),
        willRetry: attempt < maxAttempts,
        err: serializeError(err, { stack: true }),
      });
      throw err;
    }
  };
}

export interface PushReceiptsWorker {
  ready(): Promise<void>;
  /** Deja de tomar jobs y espera a que terminen los que están corriendo. */
  close(): Promise<void>;
}

export interface PushReceiptsWorkerOptions {
  redisUrl: string;
  processor: PushReceiptsProcessor;
  logger: Logger;
  prefix?: string;
}

export function createPushReceiptsWorker({
  redisUrl,
  processor,
  logger,
  prefix,
}: PushReceiptsWorkerOptions): PushReceiptsWorker {
  // Igual que el worker de análisis: conexión propia con maxRetriesPerRequest null.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<PushReceiptsJob>(
    PUSH_RECEIPTS_QUEUE,
    createPushReceiptsHandler(processor, logger),
    { connection, prefix },
  );

  let down = false;
  worker.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("worker de receipts: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("worker de receipts: Redis disponible de nuevo");
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
