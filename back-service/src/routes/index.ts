import type { KeyObject } from "node:crypto";
import { Router } from "express";
import { requireAuth } from "@caloria/shared";
import { authController } from "../controllers/auth";
import type { AuthService } from "../services/auth";

export function apiRouter({
  auth,
  publicKey,
}: {
  auth: AuthService;
  publicKey: KeyObject;
}): Router {
  const router = Router();
  const authHandlers = authController(auth);
  router.post("/auth/register", authHandlers.register);
  router.post("/auth/login", authHandlers.login);
  router.post("/auth/refresh", authHandlers.refresh);
  router.post("/auth/logout", requireAuth(publicKey), authHandlers.logout);
  return router;
}
