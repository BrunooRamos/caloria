import type { KeyObject } from "node:crypto";
import { Router } from "express";
import { authController } from "../controllers/auth";
import { mealsController } from "../controllers/meals";
import { usersController } from "../controllers/users";
import { requireAuth } from "../middleware/auth";
import { mealUpload } from "../middleware/meal-upload";
import type { AuthService } from "../services/auth";
import type { MealService } from "../services/meals";
import type { UserService } from "../services/users";

export interface ApiDeps {
  auth: AuthService;
  users: UserService;
  meals?: MealService;
  publicKey: KeyObject;
}

export function apiRouter({ auth, users, meals, publicKey }: ApiDeps): Router {
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
  if (meals) {
    // El JWT se verifica antes de leer el multipart.
    router.post("/meals", authenticated, mealUpload, mealsController(meals).create);
  }
  return router;
}
