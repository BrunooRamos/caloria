import type { KeyObject } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { AppError, verifyAccessToken } from "@caloria/shared";
import type { AccessTokenClaims } from "@caloria/shared";

const BEARER = /^Bearer (\S+)$/i;

export interface AuthLocals {
  claims: AccessTokenClaims;
  accessToken: string;
}

export function requireAuth(publicKey: KeyObject): RequestHandler {
  return (req, res, next) => {
    const accessToken = BEARER.exec(req.get("authorization") ?? "")?.[1];
    if (!accessToken) throw new AppError("UNAUTHORIZED");
    const auth: AuthLocals = { claims: verifyAccessToken(accessToken, publicKey), accessToken };
    res.locals.auth = auth;
    next();
  };
}

export function authOf(res: Response): AuthLocals | undefined {
  return res.locals.auth as AuthLocals | undefined;
}
