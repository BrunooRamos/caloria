import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { loadBillingConfig } from "../src/config";
import {
  BillingProviderError,
  InvalidWebhookSignatureError,
  createStripeBillingProvider,
} from "../src/services/billing";

const WEBHOOK_SECRET = "whsec_test_secreto";

// Sin red: el SDK apunta a un puerto cerrado, así cualquier llamada falla con error de conexión.
const provider = createStripeBillingProvider({
  secretKey: "sk_test_falsa",
  webhookSecret: WEBHOOK_SECRET,
  priceId: "price_test",
  successUrl: "https://caloria.test/ok",
  cancelUrl: "https://caloria.test/cancel",
  host: "127.0.0.1",
  port: 9,
  protocol: "http",
});

/** Firma como Stripe: `t=<unix>,v1=HMAC-SHA256(secret, "<t>.<payload>")`. */
function stripeSignature(
  payload: string,
  secret = WEBHOOK_SECRET,
  t = Math.floor(Date.now() / 1000),
) {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

function event(type: string, object: Record<string, unknown>) {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type,
    api_version: "2026-10-28.endive",
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
}

describe("services/billing/stripe", () => {
  describe("verifyWebhook", () => {
    it("checkout.session.completed de una suscripción → evento de suscripción", () => {
      const payload = event("checkout.session.completed", {
        object: "checkout.session",
        mode: "subscription",
        customer: "cus_123",
        subscription: "sub_123",
        client_reference_id: "66f1a0000000000000000001",
      });
      const parsed = provider.verifyWebhook(Buffer.from(payload), {
        "stripe-signature": stripeSignature(payload),
      });
      assert.deepEqual(parsed, {
        id: "evt_test_1",
        type: "checkout.session.completed",
        kind: "subscription",
        subscriptionId: "sub_123",
        customerId: "cus_123",
      });
    });

    it("customer.subscription.updated → evento de suscripción", () => {
      const payload = event("customer.subscription.updated", {
        object: "subscription",
        id: "sub_9",
        customer: "cus_9",
      });
      const parsed = provider.verifyWebhook(Buffer.from(payload), {
        "stripe-signature": stripeSignature(payload),
      });
      assert.equal(parsed.kind, "subscription");
    });

    it("otros eventos se ignoran", () => {
      const payload = event("invoice.created", { object: "invoice" });
      const parsed = provider.verifyWebhook(Buffer.from(payload), {
        "stripe-signature": stripeSignature(payload),
      });
      assert.equal(parsed.kind, "ignored");
    });

    it("sin firma, con otro secreto, vieja o con el body cambiado → InvalidWebhookSignatureError", () => {
      const payload = event("invoice.created", { object: "invoice" });
      const body = Buffer.from(payload);
      const cases = [
        {},
        { "stripe-signature": "" },
        { "stripe-signature": stripeSignature(payload, "whsec_otro") },
        // Stripe rechaza firmas de más de 5 minutos (replay).
        { "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, 1_700_000_000) },
      ];
      for (const headers of cases) {
        assert.throws(() => provider.verifyWebhook(body, headers), InvalidWebhookSignatureError);
      }
      assert.throws(
        () =>
          provider.verifyWebhook(Buffer.from(payload.replace("invoice", "charge")), {
            "stripe-signature": stripeSignature(payload),
          }),
        InvalidWebhookSignatureError,
      );
    });
  });

  it("si Stripe no responde: BillingProviderError con el detalle", async () => {
    const err = await provider.getSubscription("sub_123").then(
      () => assert.fail("no debía responder"),
      (e: unknown) => e,
    );
    assert.ok(err instanceof BillingProviderError);
    assert.equal(err.detail.type, "StripeConnectionError");
  });

  describe("deleteCustomer (borrado de cuenta, RNF-04)", () => {
    /** Un Stripe falso que responde `status` y `body` a todo, y anota método y ruta. */
    async function stripeReplying(status: number, body: unknown) {
      const requests: string[] = [];
      const server = createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const local = createStripeBillingProvider({
        secretKey: "sk_test_falsa",
        webhookSecret: WEBHOOK_SECRET,
        priceId: "price_test",
        successUrl: "https://caloria.test/ok",
        cancelUrl: "https://caloria.test/cancel",
        host: "127.0.0.1",
        port,
        protocol: "http",
      });
      return {
        provider: local,
        requests,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      };
    }

    it("borra el cliente en Stripe", async () => {
      const stripe = await stripeReplying(200, { id: "cus_1", object: "customer", deleted: true });
      try {
        await stripe.provider.deleteCustomer("cus_1");
        assert.deepEqual(stripe.requests, ["DELETE /v1/customers/cus_1"]);
      } finally {
        await stripe.close();
      }
    });

    it("si el cliente ya no existe (un reintento), no falla", async () => {
      const stripe = await stripeReplying(404, {
        error: {
          type: "invalid_request_error",
          code: "resource_missing",
          message: "No such customer",
        },
      });
      try {
        await stripe.provider.deleteCustomer("cus_borrado");
      } finally {
        await stripe.close();
      }
    });

    it("cualquier otro error → BillingProviderError (503 sin tocar la base)", async () => {
      const stripe = await stripeReplying(400, {
        error: { type: "invalid_request_error", code: "parameter_invalid", message: "Nope" },
      });
      try {
        const err = await stripe.provider.deleteCustomer("cus_1").then(
          () => assert.fail("tenía que fallar"),
          (e: unknown) => e,
        );
        assert.ok(err instanceof BillingProviderError);
        assert.equal(err.detail.code, "parameter_invalid");
      } finally {
        await stripe.close();
      }
    });
  });

  describe("loadBillingConfig", () => {
    const full = {
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_WEBHOOK_SECRET: "whsec_abc",
      STRIPE_PRICE_ID: "price_abc",
      BILLING_SUCCESS_URL: "https://caloria.app/billing/ok",
      BILLING_CANCEL_URL: "https://caloria.app/billing/cancel",
    };

    it("sin ninguna variable: billing apagado", () => {
      assert.equal(loadBillingConfig({}), undefined);
    });
    it("completa: la devuelve", () => {
      assert.equal(loadBillingConfig(full)?.priceId, "price_abc");
    });
    it("a medias: no arranca", () => {
      assert.throws(
        () => loadBillingConfig({ ...full, STRIPE_PRICE_ID: "" }),
        /faltan STRIPE_PRICE_ID/,
      );
    });
    it("una clave live no arranca: solo sandbox", () => {
      assert.throws(
        () => loadBillingConfig({ ...full, STRIPE_SECRET_KEY: "sk_live_abc" }),
        /clave de test/,
      );
    });
    it("URLs de vuelta que no son http(s): no arranca", () => {
      assert.throws(
        () => loadBillingConfig({ ...full, BILLING_SUCCESS_URL: "caloria://ok" }),
        /BILLING_SUCCESS_URL/,
      );
    });
  });
});
