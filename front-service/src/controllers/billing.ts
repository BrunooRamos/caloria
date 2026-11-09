import type { RequestHandler } from "express";
import { WEBHOOK_SIGNATURE_HEADER } from "@caloria/shared";
import type { BackendClient } from "../clients/backend";

export function forwardBillingWebhook(backend: BackendClient): RequestHandler {
  return async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (WEBHOOK_SIGNATURE_HEADER.test(name) && typeof value === "string") headers[name] = value;
    }
    const result = await backend.request({
      method: "POST",
      path: "/api/v1/billing/webhook",
      requestId: req.requestId,
      raw: { body, contentType: req.get("content-type") ?? "application/json" },
      headers,
    });
    res.status(result.status).set(result.headers).json(result.body);
  };
}
