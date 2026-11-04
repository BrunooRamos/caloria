import { Types } from "mongoose";
import type { PipelineStage } from "mongoose";
import { isoWeekRange } from "@caloria/shared";
import type { WeeklyMetrics } from "@caloria/shared";
import { MealModel } from "../models/Meal";
import { currentValue } from "./meal-corrections";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Un día de la semana, para el prompt. Sin registro: `meals` en 0 y sin `kcal`. */
export interface WeeklyDay {
  date: string;
  meals: number;
  /** Punto medio de las kcal corregidas del día, redondeado. */
  kcal?: number;
  /** Platos del día en orden, ya corregidos y recortados. */
  dishes: string[];
}

export interface WeeklyData {
  week: string;
  from: string;
  to: string;
  metrics: WeeklyMetrics;
  /** Los 7 días, de lunes a domingo. */
  days: WeeklyDay[];
}

/** Lo que devuelve la agregación: un documento por día con al menos una comida ready. */
export interface DayRow {
  _id: string; // localDate
  kcalMin: number;
  kcalMax: number;
  meals: { dish: string; at: Date; id: Types.ObjectId }[];
}

/** Comidas ready del usuario en la semana, agrupadas por día, con las correcciones aplicadas. */
export function weeklyMealsPipeline(userId: string, from: string, to: string): PipelineStage[] {
  return [
    {
      $match: {
        userId: new Types.ObjectId(userId),
        localDate: { $gte: from, $lte: to },
        status: "ready",
      },
    },
    { $set: { kcal: currentValue("kcal"), dish: currentValue("dish") } },
    {
      $group: {
        _id: "$localDate",
        kcalMin: { $sum: "$kcal.min" },
        kcalMax: { $sum: "$kcal.max" },
        meals: { $push: { dish: "$dish", at: "$capturedAt", id: "$_id" } },
      },
    },
  ];
}

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Para comparar platos: "Milanesa " y "milanesa" son el mismo. */
const normalizeDish = (dish: string) => dish.trim().toLowerCase();

/**
 * El plato más frecuente. Se cuenta normalizado y se devuelve como lo escribió el usuario la
 * última vez. Empate: gana el que se comió más recientemente (por `capturedAt` y después por
 * `_id`), así el resultado no depende del orden en que Mongo devuelve las comidas.
 */
export function topDishOf(meals: DayRow["meals"]): string {
  const sorted = [...meals].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.id.toString().localeCompare(b.id.toString()),
  );
  const counts = new Map<string, { count: number; label: string; last: number }>();
  sorted.forEach(({ dish }, index) => {
    const key = normalizeDish(dish);
    const entry = counts.get(key) ?? { count: 0, label: "", last: 0 };
    counts.set(key, { count: entry.count + 1, label: dish.trim(), last: index });
  });
  let best: { count: number; label: string; last: number } | undefined;
  for (const entry of counts.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.last > best.last)
    ) {
      best = entry;
    }
  }
  return best?.label ?? "";
}

/** La tira más larga de días consecutivos con registro dentro de la semana. */
function longestRun(logged: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const day of logged) {
    run = day ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Métricas y días de la semana a partir de la agregación. Sin comidas ready → undefined. */
export function summarizeWeek(week: string, rows: DayRow[]): WeeklyData | undefined {
  if (rows.length === 0) return undefined;
  const { from, to } = isoWeekRange(week);
  const byDate = new Map(rows.map((row) => [row._id, row]));

  const days: WeeklyDay[] = [];
  const mids: number[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    const row = byDate.get(date);
    if (!row) {
      days.push({ date, meals: 0, dishes: [] });
      continue;
    }
    // El punto medio sale de las sumas sin redondear, como en el dashboard.
    const mid = (row.kcalMin + row.kcalMax) / 2;
    mids.push(mid);
    const sorted = [...row.meals].sort((a, b) => a.at.getTime() - b.at.getTime());
    days.push({
      date,
      meals: row.meals.length,
      kcal: Math.round(mid),
      dishes: sorted.map(({ dish }) => dish.trim()),
    });
  }

  const metrics: WeeklyMetrics = {
    avgKcal: Math.round(mids.reduce((sum, mid) => sum + mid, 0) / mids.length),
    daysLogged: mids.length,
    streak: longestRun(days.map((day) => day.meals > 0)),
    topDish: topDishOf(rows.flatMap((row) => row.meals)),
  };
  return { week, from, to, metrics, days };
}

export interface WeeklyMetricsService {
  /** Métricas y días de la semana del usuario; undefined si no tiene comidas ready. */
  compute(userId: string, week: string): Promise<WeeklyData | undefined>;
  /** Usuarios con al menos una comida ready en la semana. */
  usersWithMeals(week: string): Promise<string[]>;
}

export function createWeeklyMetricsService(): WeeklyMetricsService {
  return {
    async compute(userId, week) {
      const { from, to } = isoWeekRange(week);
      const rows = await MealModel.aggregate<DayRow>(weeklyMealsPipeline(userId, from, to));
      return summarizeWeek(week, rows);
    },
    async usersWithMeals(week) {
      const { from, to } = isoWeekRange(week);
      const ids = await MealModel.distinct<"userId", Types.ObjectId>("userId", {
        localDate: { $gte: from, $lte: to },
        status: "ready",
      });
      return ids.map((id) => id.toString()).sort();
    },
  };
}
