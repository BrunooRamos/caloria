import { Types, mongo } from "mongoose";
import { serializeError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { AccountDeletionModel } from "../models/AccountDeletion";
import { AiUsageModel } from "../models/AiUsage";
import { GamificationModel } from "../models/Gamification";
import { MealModel } from "../models/Meal";
import { UserModel } from "../models/User";
import { WeeklySummaryModel } from "../models/WeeklySummary";
import type { BillingService } from "./billing";

/**
 * El id del dueño como ObjectId. Todo filtro del borrado se arma con esto: un id vacío, inválido o
 * no canónico lanza antes de llegar a Mongo. Así un error de programación nunca termina en un
 * `deleteMany` que matchee a otros usuarios.
 */
const OBJECT_ID = /^[0-9a-f]{24}$/;

export function ownerId(userId: string): Types.ObjectId {
  if (typeof userId !== "string" || !OBJECT_ID.test(userId)) {
    throw new Error("Id de usuario inválido para borrar una cuenta");
  }
  return new Types.ObjectId(userId);
}

export interface DeletedDocuments {
  users: number;
  meals: number;
  weeklySummaries: number;
  gamification: number;
  /** Filas de `ai_usage` a las que se les sacó el usuario y la comida. */
  aiUsageAnonymized: number;
}

/**
 * Borra los documentos de la cuenta en las cuatro collections. De `ai_usage` no se borra nada: es
 * el gasto real del mes y tiene que seguir sumando; se le sacan `userId` y `mealId`, y la fila
 * queda sin nada que la vincule a la persona. Primero el usuario: desde ese
 * momento no se puede entrar ni renovar la sesión (las sesiones viven en el documento) y no le
 * llegan más avisos (los push tokens también). Se puede repetir: lo usan el `DELETE /users/me` y
 * la limpieza final del Worker.
 */
export async function deleteAccountDocuments(userId: string): Promise<DeletedDocuments> {
  const owner = ownerId(userId);
  const users = await UserModel.deleteOne({ _id: owner });
  const [meals, weeklySummaries, gamification, aiUsage] = await Promise.all([
    MealModel.deleteMany({ userId: owner }),
    WeeklySummaryModel.deleteMany({ userId: owner }),
    GamificationModel.deleteMany({ userId: owner }),
    AiUsageModel.updateMany({ userId: owner }, { $unset: { userId: 1, mealId: 1 } }),
  ]);
  return {
    users: users.deletedCount,
    meals: meals.deletedCount,
    weeklySummaries: weeklySummaries.deletedCount,
    gamification: gamification.deletedCount,
    aiUsageAnonymized: aiUsage.modifiedCount,
  };
}

/** Si hay un pedido de borrado de esa cuenta, pendiente o terminado hace menos de una hora. */
export async function hasDeletionRequest(userId: string): Promise<boolean> {
  if (!OBJECT_ID.test(userId)) return false;
  return (await AccountDeletionModel.exists({ _id: ownerId(userId) })) !== null;
}

export interface AccountDeletionContext {
  requestId: string;
  log: Logger;
}

export interface AccountDeletionService {
  /**
   * `DELETE /users/me`. Al volver, la cuenta y sus documentos ya no existen; la media y la
   * limpieza final quedan en el Worker. Se puede repetir: un pedido que ya se hizo responde igual.
   */
  deleteAccount(userId: string, context: AccountDeletionContext): Promise<void>;
}

export interface AccountDeletionDeps {
  /** Corta la suscripción en el proveedor de pagos antes de borrar nada. */
  billing: Pick<BillingService, "closeCustomer">;
  /** Encola la limpieza final del Worker (documentos otra vez y media del bucket). */
  enqueuePurge: (userId: string) => Promise<void>;
  now?: () => Date;
}

const DUPLICATE_KEY = 11000;

export function createAccountDeletionService({
  billing,
  enqueuePurge,
  now = () => new Date(),
}: AccountDeletionDeps): AccountDeletionService {
  /** El registro del borrado. Desde acá, el Worker lo completa aunque falle lo que sigue. */
  async function recordRequest(owner: Types.ObjectId) {
    try {
      await AccountDeletionModel.updateOne(
        { _id: owner },
        { $setOnInsert: { requestedAt: now() } },
        { upsert: true },
      );
    } catch (err) {
      // Dos pedidos a la vez: uno crea el registro y el otro choca con el _id. Ya existe.
      if (!(err instanceof mongo.MongoServerError && err.code === DUPLICATE_KEY)) throw err;
    }
  }

  return {
    async deleteAccount(userId, context) {
      const { requestId, log } = context;
      const owner = ownerId(userId);
      const request = await AccountDeletionModel.findById(owner, { completedAt: 1 }).lean();
      if (request?.completedAt) {
        log.info("pedido de borrado repetido: la cuenta ya estaba borrada", { requestId, userId });
        return;
      }
      if (!request) {
        // Primero el proveedor de pagos: sin el usuario se pierde el id del cliente y se le
        // seguiría cobrando. Si falla, 503 sin haber tocado nada.
        await billing.closeCustomer(userId, context);
        await recordRequest(owner);
      }
      const deleted = await deleteAccountDocuments(userId);
      try {
        await enqueuePurge(userId);
      } catch (err) {
        // La cuenta ya no existe: el pedido queda registrado y lo retoma el barrido del Worker.
        log.warn("no se pudo encolar la limpieza de la cuenta, la retoma el barrido", {
          requestId,
          userId,
          err: serializeError(err),
        });
      }
      log.info("cuenta eliminada", { requestId, userId, deleted });
    },
  };
}
