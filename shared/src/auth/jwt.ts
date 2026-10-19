import type { KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../errors";

export const JWT_ALGORITHM = "RS256";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export type PlanTier = "free" | "premium";

export interface AccessTokenClaims {
  sub: string;
  plan: PlanTier;
}

export function verifyAccessToken(token: string, publicKey: KeyObject): AccessTokenClaims {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, publicKey, { algorithms: [JWT_ALGORITHM] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError("TOKEN_EXPIRED");
    throw new AppError("UNAUTHORIZED", undefined, { cause: err });
  }

  if (
    typeof payload === "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.sub !== "string" ||
    (payload.plan !== "free" && payload.plan !== "premium")
  ) {
    throw new AppError("UNAUTHORIZED");
  }
  return { sub: payload.sub, plan: payload.plan };
}
