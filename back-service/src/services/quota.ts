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
      const user = await UserModel.findOneAndUpdate(
        {
          _id: userId,
          $or: [
            { "plan.tier": "premium" },
            { "usage.month": { $ne: month } },
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
                    month,
                    analyses: {
                      $cond: [
                        { $eq: ["$usage.month", month] },
                        { $add: ["$usage.analyses", 1] },
                        1,
                      ],
                    },
                  },
                ],
              },
            },
          },
        ],
        { projection: { "plan.tier": 1 } },
      ).lean<Pick<User, "plan">>();

      if (!user) {
        log.info("cupo mensual agotado, se rechaza la comida", {
          requestId,
          userId,
          month,
          limit: freeMonthlyAnalyses,
        });
        throw new AppError(
          "MEAL_QUOTA_EXCEEDED",
          `Usaste los ${freeMonthlyAnalyses} análisis del plan free de este mes. ` +
            `El cupo se renueva el ${renewalLabel(month)}.`,
        );
      }
      return user.plan.tier === "premium" ? {} : { month };
    },

    async release(userId, month) {
      await UserModel.updateOne(
        { _id: userId, "usage.month": month, "usage.analyses": { $gt: 0 } },
        { $inc: { "usage.analyses": -1 } },
      );
    },
  };
}

export async function refundMealQuota(
  mealId: Types.ObjectId | string,
  now: Date = new Date(),
): Promise<boolean> {
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

  const user = await UserModel.findById(meal.userId, { "profile.timezone": 1 }).lean<
    Pick<User, "profile">
  >();
  if (!user || monthIn(user.profile.timezone, now) !== meal.quotaMonth) return false;
  const { modifiedCount } = await UserModel.updateOne(
    { _id: meal.userId, "usage.month": meal.quotaMonth, "usage.analyses": { $gt: 0 } },
    { $inc: { "usage.analyses": -1 } },
  );
  return modifiedCount === 1;
}
