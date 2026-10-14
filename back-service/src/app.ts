import express from "express";
import type { Router } from "express";
import { errorHandler, notFoundHandler, requestContext } from "@caloria/shared";
import type { Logger } from "@caloria/shared";

export interface AppOptions {
  logger: Logger;
  api?: Router;
  /** Estado de la conexión a Mongo; si no es "connected", /health responde 503. */
  mongoStatus?: () => string;
}

export function createApp({ logger, api, mongoStatus }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestContext({ logger, trustIncomingId: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    if (!mongoStatus) return res.json({ status: "ok", service: "back" });
    const mongo = mongoStatus();
    const ok = mongo === "connected";
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", service: "back", mongo });
  });
  if (api) app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return app;
}
