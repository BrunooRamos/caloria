import type { KeyObject } from "node:crypto";
import { Router } from "express";
import type { BackendClient } from "../clients/backend";
import { forward } from "../controllers/forward";
import type { ForwardTarget } from "../controllers/forward";
import { requireAuth } from "../middleware/auth";
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
];

export function apiRouter(backend: BackendClient, publicKey: KeyObject): Router {
  const router = Router();
  const authenticated = requireAuth(publicKey);
  for (const route of API_ROUTES) {
    const handlers =
      route.access === "jwt" ? [authenticated, forward(backend, route)] : [forward(backend, route)];
    router[route.method](route.path, ...handlers);
  }
  return router;
}
