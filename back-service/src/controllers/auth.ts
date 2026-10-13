import type { RequestHandler } from "express";
import { loginSchema, registerSchema } from "@caloria/shared";
import type { AuthService } from "../services/auth";

export function authController(auth: AuthService): Record<"register" | "login", RequestHandler> {
  return {
    async register(req, res) {
      res.status(201).json(await auth.register(registerSchema.parse(req.body)));
    },
    async login(req, res) {
      res.json(await auth.login(loginSchema.parse(req.body)));
    },
  };
}
