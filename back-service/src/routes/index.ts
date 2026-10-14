import type { KeyObject } from "node:crypto";
import { Router } from "express";
import { authController } from "../controllers/auth";
import { usersController } from "../controllers/users";
import { requireAuth } from "../middleware/auth";
import type { AuthService } from "../services/auth";
import type { UserService } from "../services/users";

export interface ApiDeps {
  auth: AuthService;
  users: UserService;
  publicKey: KeyObject;
}

export function apiRouter({ auth, users, publicKey }: ApiDeps): Router {
  const router = Router();
  const authHandlers = authController(auth);
  router.post("/auth/register", authHandlers.register);
  router.post("/auth/login", authHandlers.login);
  router.post("/auth/refresh", authHandlers.refresh);

  const authenticated = requireAuth(publicKey);
  // Defensa en profundidad: el Backend re-verifica el JWT aunque ya lo verificó el Front.
  router.post("/auth/logout", authenticated, authHandlers.logout);
  const userHandlers = usersController(users);
  router.get("/users/me", authenticated, userHandlers.getMe);
  router.patch("/users/me", authenticated, userHandlers.updateMe);
  return router;
}
