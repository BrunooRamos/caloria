import type { RequestHandler } from "express";
import { authClaims, loginSchema, refreshTokenSchema, registerSchema } from "@caloria/shared";
import type { AuthService } from "../services/auth";

export function authController(
  auth: AuthService,
): Record<"register" | "login" | "refresh" | "logout", RequestHandler> {
  return {
    async register(req, res) {
      res.status(201).json(await auth.register(registerSchema.parse(req.body)));
    },
    async login(req, res) {
      res.json(await auth.login(loginSchema.parse(req.body)));
    },
    async refresh(req, res) {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      res.json(await auth.refresh(refreshToken, req.log));
    },
    async logout(req, res) {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      await auth.logout(authClaims(req).sub, refreshToken);
      res.status(204).end();
    },
  };
}
