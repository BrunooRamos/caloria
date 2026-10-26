import type { RequestHandler } from "express";
import type { BackendClient } from "../clients/backend";
import { authOf } from "../middleware/auth";
import type { RouteSchema } from "../schemas";

export interface ForwardTarget {
  method: string;
  path: string;
  schema: RouteSchema;
}

/** `/meals/:id` → `/meals/66f1…` con los params ya validados. */
function fillPath(path: string, params: Record<string, unknown>): string {
  return path.replace(/:(\w+)/g, (_, name: string) => {
    const value = params[name];
    if (typeof value !== "string") throw new Error(`El esquema de ${path} no valida :${name}`);
    return encodeURIComponent(value);
  });
}

export function forward(
  backend: BackendClient,
  { method, path, schema }: ForwardTarget,
): RequestHandler {
  const httpMethod = method.toUpperCase();
  return async (req, res) => {
    const params = schema.params.parse(req.params) as Record<string, unknown>;
    const query = schema.query.parse(req.query) as Record<string, unknown>;
    const body = schema.body?.parse(req.body);

    const auth = authOf(res);
    const result = await backend.request({
      method: httpMethod,
      path: `/api/v1${fillPath(path, params)}`,
      query,
      requestId: req.requestId,
      body,
      headers: auth && { authorization: `Bearer ${auth.accessToken}` },
    });
    res.status(result.status).set(result.headers);
    if (result.body === undefined) res.end();
    else res.json(result.body);
  };
}
