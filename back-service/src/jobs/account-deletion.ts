import { Queue } from "bullmq";
import type { JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";

export const ACCOUNT_DELETION_QUEUE = "account-deletion";
/** La limpieza final de una cuenta borrada: documentos otra vez y media del bucket. */
export const ACCOUNT_PURGE_JOB = "purge";
/** El barrido: vuelve a encolar los pedidos de borrado que quedaron sin terminar. */
export const ACCOUNT_SWEEP_JOB = "sweep";

export const ACCOUNT_SWEEP_SCHEDULER_ID = "account-deletion-sweep";
export const ACCOUNT_SWEEP_EVERY_MS = 60 * 60 * 1000;
/** Un pedido más viejo que esto y sin terminar se vuelve a encolar en el barrido. */
export const ACCOUNT_SWEEP_STALE_MS = 10 * 60 * 1000;

/**
 * Espera antes de la limpieza final, para que terminen los requests que pasaron el control de
 * sesión justo antes del borrado: un `POST /meals` sube la foto en hasta 6 s y el Front corta a
 * los 10 s. Lo que alcancen a crear en ese rato lo borra la limpieza.
 */
export const ACCOUNT_PURGE_DELAY_MS = 60 * 1000;

export interface AccountPurgeJob {
  userId: string;
}

export type AccountDeletionJobData = AccountPurgeJob | Record<string, never>;

export const ACCOUNT_PURGE_JOB_OPTIONS = {
  // Cerca de una hora de reintentos (30 s, 1, 2, 4, 8, 16 y 32 min). Si se agotan, el barrido lo
  // vuelve a encolar: el pedido en Mongo sigue pendiente hasta que la limpieza termina.
  attempts: 8,
  backoff: { type: "exponential", delay: 30_000 },
  // El pedido en Mongo es lo que manda: el job se borra al terminar, bien o mal, así el barrido
  // puede volver a encolar el mismo jobId.
  removeOnComplete: true,
  removeOnFail: true,
} satisfies JobsOptions;

const SWEEP_JOB_OPTIONS = {
  // Sin reintentos: el próximo barrido es dentro de una hora.
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 60 * 60 },
} satisfies JobsOptions;

/** Uno por cuenta: mientras hay una limpieza pendiente, encolarla otra vez no la duplica. */
export const accountPurgeJobId = (userId: string) => `account-${userId}`;

const ENQUEUE_TIMEOUT_MS = 2_000;

export interface AccountDeletionQueue {
  enqueuePurge(userId: string, options?: { delayMs?: number }): Promise<void>;
  /** Registra el barrido. Idempotente: con el mismo id, un reinicio actualiza y no duplica. */
  registerSweep(): Promise<void>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface AccountDeletionQueueOptions {
  redisUrl: string;
  logger: Logger;
  /**
   * En el Backend la cola falla rápido si Redis no está (el request no espera). En el Worker
   * puede esperar a que vuelva.
   */
  failFast: boolean;
  prefix?: string;
}

export function createAccountDeletionQueue({
  redisUrl,
  logger,
  failFast,
  prefix,
}: AccountDeletionQueueOptions): AccountDeletionQueue {
  const connection = failFast
    ? new IORedis(redisUrl, { enableOfflineQueue: false, commandTimeout: ENQUEUE_TIMEOUT_MS })
    : new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<AccountDeletionJobData>(ACCOUNT_DELETION_QUEUE, { connection, prefix });

  let down = false;
  queue.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("cola de borrado de cuentas: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("cola de borrado de cuentas: Redis disponible de nuevo");
    down = false;
  });

  return {
    async enqueuePurge(userId, { delayMs = ACCOUNT_PURGE_DELAY_MS } = {}) {
      if (failFast && connection.status !== "ready") {
        throw new Error(`Redis no disponible (conexión en estado ${connection.status})`);
      }
      await queue.add(
        ACCOUNT_PURGE_JOB,
        { userId },
        { ...ACCOUNT_PURGE_JOB_OPTIONS, jobId: accountPurgeJobId(userId), delay: delayMs },
      );
    },
    async registerSweep() {
      await queue.upsertJobScheduler(
        ACCOUNT_SWEEP_SCHEDULER_ID,
        { every: ACCOUNT_SWEEP_EVERY_MS },
        { name: ACCOUNT_SWEEP_JOB, data: {}, opts: SWEEP_JOB_OPTIONS },
      );
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
