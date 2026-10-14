import { Router } from "express";
import { authController } from "../controllers/auth";
import type { AuthService } from "../services/auth";

export function apiRouter({ auth }: { auth: AuthService }): Router {
  const router = Router();
  const authHandlers = authController(auth);
  router.post("/auth/register", authHandlers.register);
  router.post("/auth/login", authHandlers.login);
  return router;
}
