import { z } from "zod";

export const dailyDashboardQuerySchema = z.object({ date: z.iso.date().optional() }).strict();
export type DailyDashboardQuery = z.infer<typeof dailyDashboardQuerySchema>;

/** Suma de los rangos del día: `mid` es el punto medio de la suma de mínimos y de máximos. */
export interface DailyRange {
  min: number;
  max: number;
  mid: number;
}

export interface DailyDashboardResponse {
  date: string;
  consumed: { kcal: DailyRange; protein: DailyRange; carbs: DailyRange; fat: DailyRange };
  targets: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  meals: { ready: number; processing: number; failed: number };
}
