import type { KeyObject } from "node:crypto";
import { Router } from "express";
import type { BackendClient } from "../clients/backend";
import { forward } from "../controllers/forward";
import { requireAuth } from "../middleware/auth";
import { schemas } from "../schemas";

export function apiRouter(backend: BackendClient, publicKey: KeyObject): Router {
  const router = Router();
  router.post("/auth/register", forward(backend, "POST", "/auth/register", schemas.register));
  router.post("/auth/login", forward(backend, "POST", "/auth/login", schemas.login));
  router.post("/auth/refresh", forward(backend, "POST", "/auth/refresh", schemas.refresh));

  const authenticated = requireAuth(publicKey);
  router.post(
    "/auth/logout",
    authenticated,
    forward(backend, "POST", "/auth/logout", schemas.logout),
  );
  router.get("/users/me", authenticated, forward(backend, "GET", "/users/me", schemas.getMe));
  router.patch(
    "/users/me",
    authenticated,
    forward(backend, "PATCH", "/users/me", schemas.updateMe),
  );
  router.delete(
    "/users/me",
    authenticated,
    forward(backend, "DELETE", "/users/me", schemas.deleteMe),
  );
  return router;
}
