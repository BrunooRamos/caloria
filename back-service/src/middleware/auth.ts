import type { KeyObject } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { isValidObjectId } from "mongoose";
import { AppError, verifyAccessToken } from "@caloria/shared";

const BEARER = /^Bearer (\S+)$/i;

export function requireAuth(publicKey: KeyObject): RequestHandler {
  return (req, res, next) => {
    const token = BEARER.exec(req.get("authorization") ?? "")?.[1];
    if (!token) throw new AppError("UNAUTHORIZED");
    const { sub } = verifyAccessToken(token, publicKey);
    if (!isValidObjectId(sub)) throw new AppError("UNAUTHORIZED");
    res.locals.userId = sub;
    next();
  };
}

export function userIdOf(res: Response): string {
  const { userId } = res.locals;
  if (typeof userId !== "string") throw new AppError("UNAUTHORIZED");
  return userId;
}
