import express from "express";
import type { Router } from "express";
import {
  BILLING_WEBHOOK_BODY_LIMIT,
  BILLING_WEBHOOK_PATH,
  errorHandler,
  notFoundHandler,
  requestContext,
} from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { backendErrorPassthrough } from "./middleware/backend-errors";

export interface AppOptions {
  logger: Logger;
  api?: Router;
}

export const JSON_BODY_LIMIT = "100kb";

export function createApp({ logger, api }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // El Front es la cara pública: nunca confía en el X-Request-Id del cliente.
  app.use(requestContext({ logger, trustIncomingId: false }));
  // El webhook de pagos se reenvía crudo: el Backend verifica la firma sobre los bytes exactos.
  app.use(
    BILLING_WEBHOOK_PATH,
    express.raw({ type: () => true, limit: BILLING_WEBHOOK_BODY_LIMIT }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "front" });
  });
  if (api) app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(backendErrorPassthrough);
  app.use(errorHandler({ logger }));
  return app;
}
