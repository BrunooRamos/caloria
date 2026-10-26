import type { RequestHandler } from "express";
import { dailyDashboardQuerySchema } from "@caloria/shared";
import { userIdOf } from "../middleware/auth";
import type { DashboardService } from "../services/dashboard";

export function dashboardController(dashboard: DashboardService): Record<"daily", RequestHandler> {
  return {
    async daily(req, res) {
      res.set("Cache-Control", "no-store");
      const { date } = dailyDashboardQuerySchema.parse(req.query);
      res.json(await dashboard.daily(userIdOf(res), date));
    },
  };
}
