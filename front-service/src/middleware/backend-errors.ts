import type { ErrorRequestHandler } from "express";
import { BackendErrorResponse } from "../clients/backend";

export const backendErrorPassthrough: ErrorRequestHandler = (err, req, res, next) => {
  if (!(err instanceof BackendErrorResponse) || res.headersSent) return next(err);
  req.log.warn("error del Backend reenviado", { status: err.status, code: err.body.error.code });
  res.status(err.status).set(err.headers).json(err.body);
};
