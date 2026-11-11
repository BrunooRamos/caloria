import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { currentRequestId } from "./context";
import { AppError, errorEnvelope } from "./errors";
import { serializeError } from "./logger";
import type { Logger } from "./logger";

const BODY_TOO_LARGE = new Set(["entity.too.large", "parameters.too.many"]);
// Errores de multer que son 400 y no 413: un archivo en un campo inesperado o un campo de texto
// que pasa el `fieldSize` (una nota larga es 400 aunque no llegue a zod).
const MULTER_VALIDATION = new Set(["LIMIT_UNEXPECTED_FILE", "LIMIT_FIELD_VALUE"]);

interface ZodLikeError {
  name: "ZodError";
  issues: { path: PropertyKey[]; code: string }[];
}

function isZodError(err: unknown): err is ZodLikeError {
  return (
    err instanceof Error &&
    err.name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

function isMulterError(err: unknown): err is Error & { code: string } {
  return err instanceof Error && err.name === "MulterError";
}

function bodyParserType(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === "string" && typeof status === "number" && status >= 400 && status < 500
    ? type
    : undefined;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (isZodError(err)) return new AppError("VALIDATION_ERROR", undefined, { cause: err });
  if (isMulterError(err)) {
    return MULTER_VALIDATION.has(err.code)
      ? new AppError("VALIDATION_ERROR", undefined, { cause: err })
      : new AppError("PAYLOAD_TOO_LARGE", undefined, { cause: err });
  }
  const type = bodyParserType(err);
  if (type !== undefined) {
    if (BODY_TOO_LARGE.has(type))
      return new AppError("PAYLOAD_TOO_LARGE", undefined, { cause: err });
    const message = type === "entity.parse.failed" ? "El cuerpo no es JSON válido" : undefined;
    return new AppError("VALIDATION_ERROR", message, { cause: err });
  }
  return new AppError("INTERNAL_ERROR", undefined, { cause: err });
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError("NOT_FOUND", "Ruta inexistente"));
};

export function errorHandler({ logger }: { logger: Logger }): ErrorRequestHandler {
  return (err, req, res, next) => {
    const requestId = req.requestId ?? currentRequestId() ?? randomUUID();
    const log = req.log ?? logger.child({ requestId });
    const appError = toAppError(err);

    if (appError.status >= 500) {
      log.error("error interno", {
        code: appError.code,
        err: serializeError(err, { stack: true }),
      });
    } else {
      log.warn("request rechazada", {
        code: appError.code,
        status: appError.status,
        ...(isZodError(err) && {
          issues: err.issues.map(({ path, code }) => ({ path: path.map(String), code })),
        }),
      });
    }

    // Si ya se empezó a mandar la respuesta no se puede cambiar: Express corta la conexión.
    if (res.headersSent) return next(err);

    if (appError.retryAfterSeconds !== undefined) {
      res.set("Retry-After", String(appError.retryAfterSeconds));
    }
    res.status(appError.status).json(errorEnvelope(appError, requestId));
  };
}
