import { Types } from "mongoose";
import { AppError, isoWeekRange } from "@caloria/shared";
import type { WeeklySummaryResponse } from "@caloria/shared";
import { WeeklySummaryModel } from "../models/WeeklySummary";
import type { WeeklySummary } from "../models/WeeklySummary";

export interface SummaryService {
  weekly(userId: string, week: string): Promise<WeeklySummaryResponse>;
}

export function createSummaryService(): SummaryService {
  return {
    async weekly(userId, week) {
      // Por dueño y semana en la misma consulta: ajeno, inexistente o no ready → el mismo 404.
      const summary = await WeeklySummaryModel.findOne({
        userId: new Types.ObjectId(userId),
        week,
        status: "ready",
      }).lean<WeeklySummary>();
      if (!summary?.metrics || !summary.insights || !summary.generatedAt) {
        throw new AppError("NOT_FOUND");
      }
      const { avgKcal, daysLogged, streak, topDish } = summary.metrics;
      // Campo por campo: ni _id, ni userId, ni status, ni promptVersion.
      return {
        week,
        ...isoWeekRange(week),
        metrics: { avgKcal, daysLogged, streak, topDish },
        insights: summary.insights,
        generatedAt: summary.generatedAt.toISOString(),
      };
    },
  };
}
