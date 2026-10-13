import { Router } from "express";
import type { RequestHandler } from "express";
import { loginSchema, registerSchema } from "@caloria/shared";
import type { BackendClient } from "../clients/backend";

export function authRouter(backend: BackendClient): Router {
  const forward =
    (path: string, schema: { parse(data: unknown): unknown }): RequestHandler =>
    async (req, res) => {
      const { status, body } = await backend.request({
        method: "POST",
        path: `/api/v1/auth/${path}`,
        requestId: req.requestId,
        body: schema.parse(req.body),
      });
      res.status(status).json(body);
    };

  const router = Router();
  router.post("/auth/register", forward("register", registerSchema));
  router.post("/auth/login", forward("login", loginSchema));
  return router;
}
