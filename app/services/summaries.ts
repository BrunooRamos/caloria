import { z } from "zod";
import { api } from "./api";

const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const weeklySummarySchema = z.object({
  week: z.string(),
  from: day,
  to: day,
  metrics: z.object({
    avgKcal: z.number().nonnegative(),
    daysLogged: count.max(7),
    streak: count.max(7),
    topDish: z.string(),
  }),
  insights: z.array(z.string()),
  generatedAt: z.string(),
  topDishPhotoUrl: z.url().optional(),
});

export type WeeklySummary = z.infer<typeof weeklySummarySchema>;

export async function getWeeklySummary(week: string, signal?: AbortSignal): Promise<WeeklySummary> {
  return weeklySummarySchema.parse(
    await api.get<unknown>(`/summaries/weekly/${encodeURIComponent(week)}`, { signal }),
  );
}
