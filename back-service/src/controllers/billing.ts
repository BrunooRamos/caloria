import type { RequestHandler } from "express";
import { userIdOf } from "../middleware/auth";
import type { BillingService } from "../services/billing";

export function billingController(
  billing: BillingService,
): Record<"plan" | "subscribe" | "cancel" | "webhook", RequestHandler> {
  const context = (req: Parameters<RequestHandler>[0]) => ({
    requestId: req.requestId,
    log: req.log,
  });
  return {
    async plan(_req, res) {
      res.json(await billing.getPlan(userIdOf(res)));
    },
    async subscribe(req, res) {
      res.json(await billing.subscribe(userIdOf(res), context(req)));
    },
    async cancel(req, res) {
      res.json(await billing.cancel(userIdOf(res), context(req)));
    },
    // Público: sin JWT. Lo autentica la firma del proveedor sobre el body crudo (express.raw en app.ts).
    async webhook(req, res) {
      const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const { duplicate } = await billing.handleWebhook(payload, req.headers, context(req));
      res.json({ received: true, duplicate });
    },
  };
}
