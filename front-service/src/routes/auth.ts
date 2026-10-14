import type { KeyObject } from "node:crypto";
import { Router } from "express";
import type { RequestHandler } from "express";
import { loginSchema, refreshTokenSchema, registerSchema, requireAuth } from "@caloria/shared";
import type { BackendClient } from "../clients/backend";

export function authRouter(
  backend: BackendClient,
  { publicKey }: { publicKey: KeyObject },
): Router {
  const forward =
    (path: string, schema: { parse(data: unknown): unknown }): RequestHandler =>
    async (req, res) => {
      const authorization = req.get("authorization");
      const { status, body } = await backend.request({
        method: "POST",
        path: `/api/v1/auth/${path}`,
        requestId: req.requestId,
        body: schema.parse(req.body),
        headers: req.auth && authorization ? { authorization } : undefined,
      });
      if (body === undefined) return void res.status(status).end();
      res.status(status).json(body);
    };

  const router = Router();
  router.post("/auth/register", forward("register", registerSchema));
  router.post("/auth/login", forward("login", loginSchema));
  router.post("/auth/refresh", forward("refresh", refreshTokenSchema));
  router.post("/auth/logout", requireAuth(publicKey), forward("logout", refreshTokenSchema));
  return router;
}
