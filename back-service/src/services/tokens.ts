import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_TTL_SECONDS, JWT_ALGORITHM } from "@caloria/shared";
import type { AccessTokenClaims } from "@caloria/shared";

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 32;

export function signAccessToken({ sub, plan }: AccessTokenClaims, privateKey: KeyObject): string {
  return jwt.sign({ plan }, privateKey, {
    algorithm: JWT_ALGORITHM,
    subject: sub,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newRefreshSession(now = new Date()) {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  return {
    token,
    session: {
      tokenHash: hashRefreshToken(token),
      family: randomUUID(),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    },
  };
}
