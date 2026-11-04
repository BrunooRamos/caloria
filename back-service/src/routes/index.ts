import type { KeyObject } from "node:crypto";
import { Router } from "express";
import { authController } from "../controllers/auth";
import { dashboardController } from "../controllers/dashboard";
import { mealsController } from "../controllers/meals";
import { summariesController } from "../controllers/summaries";
import { usersController } from "../controllers/users";
import { requireAuth } from "../middleware/auth";
import { mealUpload } from "../middleware/meal-upload";
import type { AuthService } from "../services/auth";
import type { DashboardService } from "../services/dashboard";
import type { MealService } from "../services/meals";
import type { SummaryService } from "../services/summaries";
import type { UserService } from "../services/users";

export interface ApiDeps {
  auth: AuthService;
  users: UserService;
  meals?: MealService;
  dashboard?: DashboardService;
  summaries?: SummaryService;
  publicKey: KeyObject;
}

export function apiRouter({
  auth,
  users,
  meals,
  dashboard,
  summaries,
  publicKey,
}: ApiDeps): Router {
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
    const mealHandlers = mealsController(meals);
    // El JWT se verifica antes de leer el multipart.
    router.post("/meals", authenticated, mealUpload, mealHandlers.create);
    router.get("/meals", authenticated, mealHandlers.list);
    router.get("/meals/:id", authenticated, mealHandlers.get);
    router.patch("/meals/:id", authenticated, mealHandlers.patch);
    router.delete("/meals/:id", authenticated, mealHandlers.remove);
  }
  if (dashboard) {
    router.get("/dashboard/daily", authenticated, dashboardController(dashboard).daily);
  }
  if (summaries) {
    router.get("/summaries/weekly/:week", authenticated, summariesController(summaries).weekly);
  }
  return router;
}
