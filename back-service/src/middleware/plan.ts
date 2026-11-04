import type { RequestHandler } from "express";
import { AppError } from "@caloria/shared";
import { UserModel } from "../models/User";
import type { User } from "../models/User";
import { userIdOf } from "./auth";

/**
 * Corta con 402 PREMIUM_REQUIRED si el usuario no es premium. Va después de `requireAuth`.
 */
export const requirePremium: RequestHandler = async (req, res, next) => {
  const userId = userIdOf(res);
  const user = await UserModel.findById(userId, { "plan.tier": 1 }).lean<Pick<User, "plan">>();
  if (!user) throw new AppError("UNAUTHORIZED");
  if (user.plan.tier !== "premium") {
    req.log.info("función premium con plan free, se rechaza", {
      requestId: req.requestId,
      userId,
      path: req.path,
    });
    throw new AppError("PREMIUM_REQUIRED");
  }
  next();
};
