import type { RequestHandler } from "express";
import { AppError } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { isPremium } from "../services/plan";
import { userIdOf } from "./auth";

const PLAN_FIELDS = { "plan.tier": 1, "plan.currentPeriodEnd": 1, "plan.cancelAtPeriodEnd": 1 };

export function createRequirePremium({ now = () => new Date() } = {}): RequestHandler {
  return async (req, res, next) => {
    const userId = userIdOf(res);
    const user = await UserModel.findById(userId, PLAN_FIELDS).lean<Pick<User, "plan">>();
    if (!user) throw new AppError("UNAUTHORIZED");
    if (!isPremium(user.plan, now())) {
      req.log.info("función premium con plan free, se rechaza", {
        requestId: req.requestId,
        userId,
        path: req.path,
      });
      throw new AppError("PREMIUM_REQUIRED");
    }
    next();
  };
}

export const requirePremium = createRequirePremium();
