import type { RequestHandler } from "express";
import { weeklySummaryParamsSchema } from "@caloria/shared";
import { userIdOf } from "../middleware/auth";
import type { SummaryService } from "../services/summaries";

export function summariesController(summaries: SummaryService): Record<"weekly", RequestHandler> {
  return {
    async weekly(req, res) {
      res.set("Cache-Control", "no-store");
      const { week } = weeklySummaryParamsSchema.parse(req.params);
      res.json(await summaries.weekly(userIdOf(res), week));
    },
  };
}
