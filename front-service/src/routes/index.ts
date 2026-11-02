import type { KeyObject } from "node:crypto";
import { Router } from "express";
import type { BackendClient } from "../clients/backend";
import { forward } from "../controllers/forward";
import type { ForwardTarget } from "../controllers/forward";
import { createMeal } from "../controllers/meals";
import { requireAuth } from "../middleware/auth";
import { mealUpload } from "../middleware/meal-upload";
import { schemas } from "../schemas";

export interface ApiRoute extends ForwardTarget {
  method: "get" | "post" | "patch" | "delete";
  access: "public" | "jwt";
}

export const API_ROUTES: readonly ApiRoute[] = [
  { method: "post", path: "/auth/register", access: "public", schema: schemas.register },
  { method: "post", path: "/auth/login", access: "public", schema: schemas.login },
  { method: "post", path: "/auth/refresh", access: "public", schema: schemas.refresh },
  { method: "post", path: "/auth/logout", access: "jwt", schema: schemas.logout },
  { method: "get", path: "/users/me", access: "jwt", schema: schemas.getMe },
  { method: "patch", path: "/users/me", access: "jwt", schema: schemas.updateMe },
  { method: "delete", path: "/users/me", access: "jwt", schema: schemas.deleteMe },
  { method: "get", path: "/meals", access: "jwt", schema: schemas.listMeals },
  { method: "get", path: "/meals/:id", access: "jwt", schema: schemas.getMeal },
  { method: "patch", path: "/meals/:id", access: "jwt", schema: schemas.correctMeal },
  { method: "delete", path: "/meals/:id", access: "jwt", schema: schemas.deleteMeal },
  { method: "get", path: "/dashboard/daily", access: "jwt", schema: schemas.getDailyDashboard },
  {
    method: "get",
    path: "/summaries/weekly/:week",
    access: "jwt",
    schema: schemas.getWeeklySummary,
  },
];

export function apiRouter(backend: BackendClient, publicKey: KeyObject): Router {
  const router = Router();
  const authenticated = requireAuth(publicKey);
  for (const route of API_ROUTES) {
    const handlers =
      route.access === "jwt" ? [authenticated, forward(backend, route)] : [forward(backend, route)];
    router[route.method](route.path, ...handlers);
  }
  // Multipart: el JWT se verifica antes de leer el body.
  router.post("/meals", authenticated, mealUpload, createMeal(backend, schemas.createMeal));
  return router;
}
