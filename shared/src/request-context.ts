import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { runWithRequestContext } from "./context";
import type { Logger } from "./logger";

export const REQUEST_ID_HEADER = "X-Request-Id";

declare global {
  // Express solo permite extender Request con este namespace global.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export interface RequestContextOptions {
  logger: Logger;
  /**
   * false (Front): siempre genera un UUID nuevo e ignora el header del cliente.
   * true (Backend): usa el X-Request-Id que manda el Front; si falta o es inválido, genera uno y avisa.
   */
  trustIncomingId: boolean;
}

export function requestContext({ logger, trustIncomingId }: RequestContextOptions): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const requestId = trustIncomingId && isValidRequestId(incoming) ? incoming : randomUUID();

    req.requestId = requestId;
    req.log = logger.child({ requestId });
    res.setHeader(REQUEST_ID_HEADER, requestId);

    if (trustIncomingId && requestId !== incoming) {
      req.log.warn("X-Request-Id ausente o inválido; se generó uno nuevo", {
        reason: incoming === undefined ? "missing" : "invalid",
      });
    }

    const start = process.hrtime.bigint();
    res.on("finish", () => {
      req.log.info("request", {
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - start) / 1e6,
      });
    });

    runWithRequestContext({ requestId }, next);
  };
}
