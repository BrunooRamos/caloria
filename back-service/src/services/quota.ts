import type { Types } from "mongoose";
import { AppError } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { localDateIn } from "./local-date";

export function monthIn(timeZone: string, at: Date): string {
  return localDateIn(timeZone, at).slice(0, 7);
}

export function renewalLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthIndex, 1)),
  );
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
      const month = monthIn(timeZone, now());
      const isPremium = { $eq: ["$plan.tier", "premium"] };
      const keepsMonth = { $gte: ["$usage.month", month] };
      const user = await UserModel.findOneAndUpdate(
        {
          _id: userId,
          $or: [
            { "plan.tier": "premium" },
            { "usage.month": { $exists: false } },
            { "usage.month": { $lt: month } },
            { "usage.analyses": { $lt: freeMonthlyAnalyses } },
          ],
        },
        [
          {
            $set: {
              usage: {
                $cond: [
                  isPremium,
                  "$usage",
                  {
                    month: { $cond: [keepsMonth, "$usage.month", month] },
                    analyses: { $cond: [keepsMonth, { $add: ["$usage.analyses", 1] }, 1] },
                  },
                ],
              },
            },
          },
        ],
        { new: true, projection: { "plan.tier": 1, "usage.month": 1 } },
      ).lean<Pick<User, "plan" | "usage">>();

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
      return user.plan.tier === "premium" ? {} : { month: user.usage.month };
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
