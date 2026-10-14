import express from "express";
import type { Router } from "express";
import { errorHandler, notFoundHandler, requestContext } from "@caloria/shared";
import type { Logger } from "@caloria/shared";
import { backendErrorPassthrough } from "./middleware/backend-errors";

export interface AppOptions {
  logger: Logger;
  api?: Router;
}

export function createApp({ logger, api }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");

  // El Front es la cara pública: nunca confía en el X-Request-Id del cliente.
  app.use(requestContext({ logger, trustIncomingId: false }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "front" });
  });
  if (api) app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(backendErrorPassthrough);
  app.use(errorHandler({ logger }));
  return app;
}
