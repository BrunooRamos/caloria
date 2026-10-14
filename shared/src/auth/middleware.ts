import type { KeyObject } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { AppError } from "../errors";
import { verifyAccessToken } from "./jwt";
import type { AccessTokenClaims } from "./jwt";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

const BEARER = /^Bearer ([^\s]+)$/;

export function requireAuth(publicKey: KeyObject): RequestHandler {
  return (req, _res, next) => {
    const token = BEARER.exec(req.get("authorization") ?? "")?.[1];
    if (!token) throw new AppError("UNAUTHORIZED");
    req.auth = verifyAccessToken(token, publicKey);
    next();
  };
}

export function authClaims(req: Request): AccessTokenClaims {
  if (!req.auth) throw new AppError("UNAUTHORIZED");
  return req.auth;
}
