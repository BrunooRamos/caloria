import type { Types } from "mongoose";
import { AppError, serializeError } from "@caloria/shared";
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

/**
 * Segundos que faltan para la próxima medianoche en `timeZone`. Alcanza con la hora local: en un
 * cambio de horario puede errar por una hora, y el Retry-After es solo una indicación.
 */
export function secondsUntilNextLocalDay(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = part("hour") * 3600 + part("minute") * 60 + part("second");
  return Math.max(1, 86_400 - elapsed);
}

function hoursLabel(seconds: number): string {
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }
  const hours = Math.ceil(seconds / 3600);
  return `${hours} ${hours === 1 ? "hora" : "horas"}`;
}

/** Fotos por día que se pueden analizar, según el plan (RNF-07). */
export interface DailyAnalyses {
  free: number;
  premium: number;
}

export const DEFAULT_DAILY_ANALYSES: DailyAnalyses = { free: 20, premium: 100 };

export interface RemainingAnalyses {
  /** null en premium: sin límite. */
  limit: number | null;
  remaining: number | null;
  resetsOn: string | null;
}

export interface QuotaReservation {
  /** Mes en el que se consumió cupo; undefined si el usuario es premium (no tiene cupo). */
  month?: string;
  /** Día local ("YYYY-MM-DD") en el que se consumió el tope diario. */
  day?: string;
}

export interface QuotaContext {
  requestId: string;
  log: Logger;
}

export interface QuotaService {
  /**
   * Reserva una foto del tope diario (free y premium) y, en free, un análisis del cupo mensual.
   * Lanza DAILY_LIMIT_EXCEEDED (429, con Retry-After) o MEAL_QUOTA_EXCEEDED (402).
   */
  reserve(userId: string, timeZone: string, context: QuotaContext): Promise<QuotaReservation>;
  /** Devuelve lo reservado por `reserve` cuando la comida no llegó a crearse. */
  release(userId: string, reservation: QuotaReservation): Promise<void>;
  /** Análisis que le quedan en el mes, sin reservar nada. */
  remaining(user: Pick<User, "plan" | "usage" | "profile">, at?: Date): RemainingAnalyses;
}

export interface QuotaServiceDeps {
  /** Análisis por mes del plan free (FREE_MONTHLY_ANALYSES). */
  freeMonthlyAnalyses: number;
  /** Tope de fotos por día y por plan (DAILY_ANALYSES_FREE y DAILY_ANALYSES_PREMIUM). */
  dailyAnalyses?: DailyAnalyses;
  now?: () => Date;
}

export function createQuotaService({
  freeMonthlyAnalyses,
  dailyAnalyses = DEFAULT_DAILY_ANALYSES,
  now = () => new Date(),
}: QuotaServiceDeps): QuotaService {
  async function releaseDay(userId: string, day: string) {
    await UserModel.updateOne(
      { _id: userId, "dailyUsage.date": day, "dailyUsage.analyses": { $gt: 0 } },
      { $inc: { "dailyUsage.analyses": -1 } },
    );
  }

  async function releaseMonth(userId: string, month: string) {
    await UserModel.updateOne(
      { _id: userId, "usage.month": month, "usage.analyses": { $gt: 0 } },
      { $inc: { "usage.analyses": -1 } },
    );
  }

  /**
   * Suma una foto al día local `day` si no llegó al tope; si el día guardado es anterior, arranca
   * de cero. Atómico: dos fotos a la vez no pasan el tope. Devuelve false si está en el tope.
   */
  async function reserveDay(userId: string, day: string, limit: number): Promise<boolean> {
    const keepsDay = { $gte: ["$dailyUsage.date", day] };
    const user = await UserModel.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { "dailyUsage.date": { $exists: false } },
          { "dailyUsage.date": { $lt: day } },
          { "dailyUsage.analyses": { $lt: limit } },
        ],
      },
      [
        {
          $set: {
            dailyUsage: {
              date: { $cond: [keepsDay, "$dailyUsage.date", day] },
              analyses: { $cond: [keepsDay, { $add: ["$dailyUsage.analyses", 1] }, 1] },
            },
          },
        },
      ],
      { new: true, projection: { _id: 1 } },
    ).lean();
    return user !== null;
  }

  /** Suma un análisis al cupo mensual del plan free. Lanza MEAL_QUOTA_EXCEEDED si no queda. */
  async function reserveMonth(
    userId: string,
    timeZone: string,
    at: Date,
    { requestId, log }: QuotaContext,
  ): Promise<string> {
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
    return user.usage.month;
  }

  return {
    async reserve(userId, timeZone, { requestId, log }) {
      const at = now();
      // El plan se lee de la base (no del JWT) y se decide con isPremium: un premium vencido ya
      // cuenta como free aunque no haya llegado el webhook de fin de suscripción.
      const current = await UserModel.findById(userId, { plan: 1 }).lean<Pick<User, "plan">>();
      const premium = Boolean(current && isPremium(current.plan, at));

      // Tope diario (RNF-07): frena el gasto en IA también en premium.
      const day = localDateIn(timeZone, at);
      const dailyLimit = premium ? dailyAnalyses.premium : dailyAnalyses.free;
      if (!(await reserveDay(userId, day, dailyLimit))) {
        const retryAfterSeconds = secondsUntilNextLocalDay(timeZone, at);
        log.info("tope diario de fotos alcanzado, se rechaza la comida", {
          requestId,
          userId,
          day,
          limit: dailyLimit,
          plan: premium ? "premium" : "free",
          retryAfterSeconds,
        });
        throw new AppError(
          "DAILY_LIMIT_EXCEEDED",
          `Llegaste a las ${dailyLimit} fotos por día de tu plan. ` +
            `Podés volver a intentar en ${hoursLabel(retryAfterSeconds)}, a la medianoche.`,
          { retryAfterSeconds },
        );
      }
      if (premium) return { day };

      try {
        const month = await reserveMonth(userId, timeZone, at, { requestId, log });
        return { day, month };
      } catch (err) {
        // Sin cupo mensual la foto no se analiza: no cuenta para el día.
        await releaseDay(userId, day).catch((releaseErr: unknown) => {
          log.error("no se pudo devolver el tope diario", { err: serializeError(releaseErr) });
        });
        throw err;
      }
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

    async release(userId, { day, month }) {
      await Promise.all([
        day === undefined ? undefined : releaseDay(userId, day),
        month === undefined ? undefined : releaseMonth(userId, month),
      ]);
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
