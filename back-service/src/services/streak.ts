import { mongo } from "mongoose";
import type { Streak } from "../models/Gamification";
import { GamificationModel } from "../models/Gamification";

export interface StreakSummary {
  current: number;
  best: number;
}

export interface StreakService {
  /** Cuenta el día `localDate` en la racha; registrar varias veces el mismo día suma una sola vez. */
  record(userId: string, localDate: string): Promise<void>;
  /** La racha respecto de `today`: si el último registro es anterior a ayer, la actual es 0. */
  summary(userId: string, today: string): Promise<StreakSummary>;
}

/** Aritmética de calendario sobre "YYYY-MM-DD": en UTC no hay cambios de horario que corran el día. */
export function previousDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function streakAsOf(streak: Streak | undefined, today: string): StreakSummary {
  if (!streak) return { current: 0, best: 0 };
  // Un lastLogDate posterior a hoy (el usuario cambió a una zona más al oeste) también sigue viva.
  const alive = streak.lastLogDate >= previousDay(today);
  return { current: alive ? streak.current : 0, best: streak.best };
}

function recordPipeline(localDate: string) {
  const last = "$streak.lastLogDate";
  const current = {
    $cond: [{ $eq: [last, previousDay(localDate)] }, { $add: ["$streak.current", 1] }, 1],
  };
  return [
    {
      $set: {
        badges: { $ifNull: ["$badges", []] },
        streak: {
          $cond: [
            { $lt: [{ $ifNull: [last, ""] }, localDate] },
            {
              $let: {
                vars: { current },
                in: {
                  current: "$$current",
                  best: { $max: [{ $ifNull: ["$streak.best", 0] }, "$$current"] },
                  lastLogDate: { $literal: localDate },
                },
              },
            },
            "$streak",
          ],
        },
      },
    },
  ];
}

function isDuplicateKey(err: unknown): boolean {
  return err instanceof mongo.MongoServerError && err.code === 11000;
}

export function createStreakService(): StreakService {
  const upsert = (userId: string, localDate: string) =>
    GamificationModel.updateOne({ userId }, recordPipeline(localDate), { upsert: true });

  return {
    async record(userId, localDate) {
      try {
        await upsert(userId, localDate);
      } catch (err) {
        // Dos primeras comidas a la vez: las dos intentan crear el documento y una choca con el
        // índice único. Al reintentar el documento ya existe y se actualiza.
        if (!isDuplicateKey(err)) throw err;
        await upsert(userId, localDate);
      }
    },

    async summary(userId, today) {
      const doc = await GamificationModel.findOne({ userId }, { streak: 1 }).lean<{
        streak?: Streak;
      }>();
      return streakAsOf(doc?.streak, today);
    },
  };
}
