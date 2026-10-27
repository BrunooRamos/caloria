import { z } from "zod";
import { api } from "./api";

const count = z.number().int().nonnegative();
const dailyRange = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  mid: z.number().nonnegative(),
});

const dailyDashboardSchema = z.object({
  date: z.string(),
  consumed: z.object({ kcal: dailyRange, protein: dailyRange, carbs: dailyRange, fat: dailyRange }),
  targets: z.object({
    kcal: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    carbsG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
  }),
  meals: z.object({ ready: count, processing: count, failed: count }),
});

export type DailyRange = z.infer<typeof dailyRange>;
/** `GET /dashboard/daily`: consumido del día (comidas `ready`) contra la meta. */
export type DailyDashboard = z.infer<typeof dailyDashboardSchema>;

export async function getDailyDashboard(signal?: AbortSignal): Promise<DailyDashboard> {
  return dailyDashboardSchema.parse(await api.get<unknown>("/dashboard/daily", { signal }));
}
