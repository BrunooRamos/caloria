import type { RequestHandler } from "express";
import { loginSchema, refreshSchema, registerSchema } from "@caloria/shared";
import { userIdOf } from "../middleware/auth";
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
      const { refreshToken } = refreshSchema.parse(req.body);
      res.json(await auth.refresh(refreshToken, req.log));
    },
    async logout(req, res) {
      const { refreshToken } = refreshSchema.parse(req.body);
      await auth.logout(userIdOf(res), refreshToken);
      res.status(204).end();
    },
  };
}
