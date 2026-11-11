import { Worker } from "bullmq";
import type { Job } from "bullmq";
import IORedis from "ioredis";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { ACCOUNT_DELETION_QUEUE, ACCOUNT_PURGE_JOB, ACCOUNT_SWEEP_JOB } from "./account-deletion";
import type { AccountDeletionJobData, AccountPurgeJob } from "./account-deletion";
import type { AccountPurgeProcessor, AccountSweep } from "./account-deletion-processor";

/** Lo que el handler lee del job de BullMQ; alcanza con esto para testearlo sin Redis. */
export type AccountDeletionJobRun = Pick<
  Job<AccountDeletionJobData>,
  "name" | "data" | "attemptsMade" | "opts"
>;

export interface AccountDeletionHandlerDeps {
  purge: AccountPurgeProcessor;
  sweep: AccountSweep;
}

/** Reparte por nombre de job y loguea intento y duración, salga bien o mal. */
export function createAccountDeletionHandler(
  { purge, sweep }: AccountDeletionHandlerDeps,
  logger: Logger,
) {
  return async ({ name, data, attemptsMade, opts }: AccountDeletionJobRun) => {
    const isPurge = name === ACCOUNT_PURGE_JOB;
    if (!isPurge && name !== ACCOUNT_SWEEP_JOB) {
      throw new Error(`Job desconocido en la cola ${ACCOUNT_DELETION_QUEUE}: ${name}`);
    }
    const attempt = attemptsMade + 1;
    const maxAttempts = opts.attempts ?? 1;
    const purgeJob = data as AccountPurgeJob;
    const log = logger.child({
      job: name,
      ...(isPurge && { userId: purgeJob.userId }),
      attempt,
      maxAttempts,
    });
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    try {
      if (isPurge) {
        const outcome = await purge(purgeJob, log);
        log.info("job de borrado de cuenta terminado", { outcome, durationMs: durationMs() });
      } else {
        await sweep(log);
      }
    } catch (err) {
      log.error("job de borrado de cuenta falló", {
        durationMs: durationMs(),
        willRetry: attempt < maxAttempts,
        err: serializeError(err, { stack: true }),
      });
      throw err;
    }
  };
}

export interface AccountDeletionWorker {
  ready(): Promise<void>;
  /** Deja de tomar jobs y espera a que terminen los que están corriendo. */
  close(): Promise<void>;
}

export interface AccountDeletionWorkerOptions extends AccountDeletionHandlerDeps {
  redisUrl: string;
  logger: Logger;
  prefix?: string;
}

export function createAccountDeletionWorker({
  redisUrl,
  logger,
  prefix,
  ...deps
}: AccountDeletionWorkerOptions): AccountDeletionWorker {
  // Comandos bloqueantes: BullMQ exige maxRetriesPerRequest null y una conexión propia.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  // De a uno: borrar no apura y así no compite con los análisis por el bucket.
  const worker = new Worker<AccountDeletionJobData>(
    ACCOUNT_DELETION_QUEUE,
    createAccountDeletionHandler(deps, logger),
    { connection, concurrency: 1, prefix },
  );

  let down = false;
  worker.on("error", (err) => {
    if (down) return;
    down = true;
    logger.warn("worker de borrado de cuentas: Redis no disponible", { err: serializeError(err) });
  });
  connection.on("ready", () => {
    if (down) logger.info("worker de borrado de cuentas: Redis disponible de nuevo");
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
