import express from "express";
import type { Router } from "express";
import { errorHandler, notFoundHandler, requestContext } from "@caloria/shared";
import type { Logger } from "@caloria/shared";

export interface AppOptions {
  logger: Logger;
  api?: Router;
}

export function createApp({ logger, api }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestContext({ logger, trustIncomingId: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "back" });
  });
  if (api) app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return app;
}
