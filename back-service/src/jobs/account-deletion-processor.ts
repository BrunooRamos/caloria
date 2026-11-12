import type { Logger } from "@caloria/shared";
import { AccountDeletionModel } from "../models/AccountDeletion";
import { deleteAccountDocuments, ownerId } from "../services/account-deletion";
import type { MediaService } from "../services/media";
import { ACCOUNT_SWEEP_STALE_MS } from "./account-deletion";
import type { AccountDeletionQueue, AccountPurgeJob } from "./account-deletion";

/** Qué pasó con el job, para el log. Ninguno de los tres se reintenta. */
export type AccountPurgeOutcome = "purged" | "already-done" | "no-request";

export type AccountPurgeProcessor = (
  job: AccountPurgeJob,
  log: Logger,
) => Promise<AccountPurgeOutcome>;

export interface AccountPurgeDeps {
  media: Pick<MediaService, "removeUserMedia">;
  now?: () => Date;
}

/**
 * La limpieza final de una cuenta borrada. Vuelve a borrar los documentos (lo que un request o un
 * job en vuelo haya alcanzado a crear), borra la media del prefijo `users/{userId}/` y recién
 * entonces marca el pedido como terminado. Si algo falla, lanza: BullMQ reintenta y el pedido
 * sigue pendiente para el barrido.
 */
export function createAccountPurgeProcessor({
  media,
  now = () => new Date(),
}: AccountPurgeDeps): AccountPurgeProcessor {
  return async ({ userId }, log) => {
    const owner = ownerId(userId);
    const request = await AccountDeletionModel.findById(owner).lean();
    // Nunca se borra una cuenta sin un pedido registrado: un job con un id equivocado no toca nada.
    if (!request) {
      log.error("job de borrado sin pedido registrado: no se borra nada");
      return "no-request";
    }
    if (request.completedAt) {
      log.info("la cuenta ya estaba borrada por completo, se saltea");
      return "already-done";
    }
    const deleted = await deleteAccountDocuments(userId);
    await media.removeUserMedia(userId);
    await AccountDeletionModel.updateOne(
      { _id: owner, completedAt: { $exists: false } },
      { $set: { completedAt: now() } },
    );
    log.info("cuenta borrada por completo: documentos y media", { deleted });
    return "purged";
  };
}

export type AccountSweep = (log: Logger) => Promise<{ pending: number }>;

export interface AccountSweepDeps {
  queue: Pick<AccountDeletionQueue, "enqueuePurge">;
  now?: () => Date;
}

/**
 * Vuelve a encolar, sin espera, los pedidos pendientes de hace más de 10 minutos: se cayó Redis al
 * encolar, Redis perdió el job o se agotaron los reintentos. Si la limpieza de esa cuenta todavía
 * está en la cola, el jobId repetido no la duplica.
 */
export function createAccountSweep({
  queue,
  now = () => new Date(),
}: AccountSweepDeps): AccountSweep {
  return async (log) => {
    const before = new Date(now().getTime() - ACCOUNT_SWEEP_STALE_MS);
    const pending = await AccountDeletionModel.find(
      { completedAt: { $exists: false }, requestedAt: { $lt: before } },
      { _id: 1 },
    ).lean();
    for (const { _id } of pending) {
      await queue.enqueuePurge(_id.toString(), { delayMs: 0 });
    }
    log.info("barrido de borrados de cuenta pendientes", { pending: pending.length });
    return { pending: pending.length };
  };
}
