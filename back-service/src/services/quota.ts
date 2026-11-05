import type { Types } from "mongoose";
import { AppError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { localDateIn } from "./local-date";
import { isPremium } from "./plan";

export function monthIn(timeZone: string, at: Date): string {
  return localDateIn(timeZone, at).slice(0, 7);
}

function nextMonthStart(month: string): Date {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex, 1));
}

export function renewalLabel(month: string): string {
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    nextMonthStart(month),
  );
}

/** "2026-10" → "2026-11-01"; "2026-12" → "2027-01-01". */
export function firstDayOfNextMonth(month: string): string {
  return nextMonthStart(month).toISOString().slice(0, 10);
}

export interface RemainingAnalyses {
  /** null en premium: sin límite. */
  limit: number | null;
  remaining: number | null;
  resetsOn: string | null;
}

export interface QuotaReservation {
  /** Mes en el que se consumió cupo; undefined si el usuario es premium (no tiene cupo). */
  month?: string;
}

export interface QuotaContext {
  requestId: string;
  log: Logger;
}

export interface QuotaService {
  reserve(userId: string, timeZone: string, context: QuotaContext): Promise<QuotaReservation>;
  release(userId: string, month: string): Promise<void>;
  /** Análisis que le quedan en el mes, sin reservar nada. */
  remaining(user: Pick<User, "plan" | "usage" | "profile">, at?: Date): RemainingAnalyses;
}

export interface QuotaServiceDeps {
  /** Análisis por mes del plan free (FREE_MONTHLY_ANALYSES). */
  freeMonthlyAnalyses: number;
  now?: () => Date;
}

export function createQuotaService({
  freeMonthlyAnalyses,
  now = () => new Date(),
}: QuotaServiceDeps): QuotaService {
  return {
    async reserve(userId, timeZone, { requestId, log }) {
      const at = now();
      // El plan se lee de la base (no del JWT) y se decide con isPremium: un premium vencido ya
      // cuenta como free aunque no haya llegado el webhook de fin de suscripción.
      const current = await UserModel.findById(userId, { plan: 1 }).lean<Pick<User, "plan">>();
      if (current && isPremium(current.plan, at)) return {};

      const month = monthIn(timeZone, at);
      const keepsMonth = { $gte: ["$usage.month", month] };
      const user = await UserModel.findOneAndUpdate(
        {
          _id: userId,
          $or: [
            { "usage.month": { $exists: false } },
            { "usage.month": { $lt: month } },
            { "usage.analyses": { $lt: freeMonthlyAnalyses } },
          ],
        },
        [
          {
            $set: {
              usage: {
                month: { $cond: [keepsMonth, "$usage.month", month] },
                analyses: { $cond: [keepsMonth, { $add: ["$usage.analyses", 1] }, 1] },
              },
            },
          },
        ],
        { new: true, projection: { "usage.month": 1 } },
      ).lean<Pick<User, "usage">>();

      if (!user) {
        // Solo para el mensaje: el mes que se agotó puede ser posterior al de la zona actual.
        const stored = await UserModel.findById(userId, { "usage.month": 1 }).lean<
          Pick<User, "usage">
        >();
        const exhausted =
          stored?.usage?.month && stored.usage.month > month ? stored.usage.month : month;
        log.info("cupo mensual agotado, se rechaza la comida", {
          requestId,
          userId,
          month: exhausted,
          limit: freeMonthlyAnalyses,
        });
        throw new AppError(
          "MEAL_QUOTA_EXCEEDED",
          `Usaste los ${freeMonthlyAnalyses} análisis del plan free de este mes. ` +
            `El cupo se renueva el ${renewalLabel(exhausted)}.`,
        );
      }
      return { month: user.usage.month };
    },

    remaining(user, at = now()) {
      if (isPremium(user.plan, at)) return { limit: null, remaining: null, resetsOn: null };
      const month = monthIn(user.profile.timezone, at);
      const stored = user.usage?.month;
      const counting = stored && stored >= month ? stored : month;
      const used = stored && stored >= month ? user.usage.analyses : 0;
      return {
        limit: freeMonthlyAnalyses,
        remaining: Math.max(0, freeMonthlyAnalyses - used),
        resetsOn: firstDayOfNextMonth(counting),
      };
    },

    async release(userId, month) {
      await UserModel.updateOne(
        { _id: userId, "usage.month": month, "usage.analyses": { $gt: 0 } },
        { $inc: { "usage.analyses": -1 } },
      );
    },
  };
}

export async function refundMealQuota(mealId: Types.ObjectId | string): Promise<boolean> {
  const meal = await MealModel.findOneAndUpdate(
    {
      _id: mealId,
      status: "failed",
      quotaMonth: { $exists: true },
      quotaRefunded: { $ne: true },
    },
    { $set: { quotaRefunded: true } },
    { projection: { userId: 1, quotaMonth: 1 } },
  ).lean<{ userId: Types.ObjectId; quotaMonth: string }>();
  if (!meal) return false;

  try {
    const { modifiedCount } = await UserModel.updateOne(
      { _id: meal.userId, "usage.month": meal.quotaMonth, "usage.analyses": { $gt: 0 } },
      { $inc: { "usage.analyses": -1 } },
    );
    return modifiedCount === 1;
  } catch (err) {
    await MealModel.updateOne({ _id: mealId }, { $unset: { quotaRefunded: 1 } });
    throw err;
  }
}
