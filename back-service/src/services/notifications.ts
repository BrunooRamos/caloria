import { serializeError } from "@caloria/shared";
import type { Logger, NotificationType } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import type { PushReceiptsQueue } from "../jobs/push-receipts";
import type { PushMessage, PushService } from "./push";

/** Cada aviso con el id que la app necesita para abrir la pantalla. */
export type Notification =
  | { type: "analysisReady"; mealId: string }
  | { type: "streakRisk" }
  | { type: "wrappedReady"; week: string };

/** Qué pasó con el aviso. Salvo `sent`, no se mandó nada. */
export type NotifyOutcome = "sent" | "disabled" | "noDevices" | "failed";

// Se ven con la pantalla bloqueada: nada de kcal ni de lo que comió.
const TEXTS: Record<NotificationType, Pick<PushMessage, "title" | "body">> = {
  analysisReady: { title: "Tu comida está lista", body: "Entrá para ver el análisis." },
  streakRisk: { title: "Tu racha está en riesgo", body: "Hoy todavía no registraste nada." },
  wrappedReady: { title: "Tu resumen semanal está listo", body: "Mirá cómo te fue la semana." },
};

function toMessage({ type, ...ids }: Notification): PushMessage {
  return { ...TEXTS[type], data: { type, ...ids } };
}

/** Saca los tokens del usuario y devuelve cuántos tenía. */
export async function removePushTokens(userId: string, tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;
  const before = await UserModel.findOneAndUpdate(
    { _id: userId },
    { $pull: { pushTokens: { $in: tokens } } },
    { projection: { pushTokens: 1 } },
  ).lean<Pick<User, "pushTokens">>();
  return before?.pushTokens?.filter((token) => tokens.includes(token)).length ?? 0;
}

export interface NotificationService {
  /** Manda el aviso si el tipo está prendido y hay tokens. Nunca lanza: si falla, lo loguea. */
  notify(userId: string, notification: Notification, log?: Logger): Promise<NotifyOutcome>;
  /** Para el cron del Wrapped (#36), cuando termina el resumen de `week`. */
  notifyWrappedReady(userId: string, week: string, log?: Logger): Promise<NotifyOutcome>;
}

export interface NotificationServiceDeps {
  push: PushService;
  /** Donde se encolan los receipts a consultar más tarde. */
  receipts: Pick<PushReceiptsQueue, "enqueue">;
  logger: Logger;
}

export function createNotificationService({
  push,
  receipts,
  logger,
}: NotificationServiceDeps): NotificationService {
  async function notify(userId: string, notification: Notification, parent = logger) {
    const { type } = notification;
    const log = parent.child({ userId, type });
    const started = performance.now();
    const durationMs = () => Math.round(performance.now() - started);
    let devices = 0;
    try {
      const user = await UserModel.findById(userId, {
        pushTokens: 1,
        notifications: 1,
      }).lean<Pick<User, "pushTokens" | "notifications">>();
      // Sin el campo guardado, el aviso está prendido.
      if (user?.notifications?.[type] === false) {
        log.info("aviso salteado", { reason: "disabled" });
        return "disabled";
      }
      const tokens = user?.pushTokens ?? [];
      devices = tokens.length;
      if (devices === 0) {
        log.info("aviso salteado", { reason: "noDevices" });
        return "noDevices";
      }

      const result = await push.send(tokens, toMessage(notification));
      const removed = await removePushTokens(userId, result.invalid);
      log.info("aviso enviado", {
        devices,
        ok: result.ok,
        failed: result.failed,
        removed,
        durationMs: durationMs(),
      });

      // DeviceNotRegistered también puede llegar recién en el receipt.
      if (result.receipts.length > 0) {
        try {
          await receipts.enqueue({ userId, type, receipts: result.receipts });
        } catch (err) {
          log.warn("no se pudieron encolar los receipts del aviso", { err: serializeError(err) });
        }
      }
      return "sent";
    } catch (err) {
      log.error("aviso falló", {
        devices,
        durationMs: durationMs(),
        err: serializeError(err, { stack: true }),
      });
      return "failed";
    }
  }

  return {
    notify,
    notifyWrappedReady: (userId, week, log) => notify(userId, { type: "wrappedReady", week }, log),
  };
}
