import type { RequestHandler } from "express";
import type { BackendClient } from "../clients/backend";
import { authOf } from "../middleware/auth";
import type { RouteSchema } from "../schemas";

/**
 * Valida body, params y query con zod y reenvía al Backend solo lo validado.
 * Si la ruta pasó por requireAuth, reenvía el mismo access token: el Backend lo re-verifica.
 */
export function forward(
  backend: BackendClient,
  method: string,
  path: string,
  schema: RouteSchema,
): RequestHandler {
  return async (req, res) => {
    schema.params.parse(req.params);
    schema.query.parse(req.query);
    const body = schema.body?.parse(req.body);

    const auth = authOf(res);
    const result = await backend.request({
      method,
      path: `/api/v1${path}`,
      requestId: req.requestId,
      body,
      headers: auth && { authorization: `Bearer ${auth.accessToken}` },
    });
    if (result.body === undefined) res.status(result.status).end();
    else res.status(result.status).json(result.body);
  };
}
