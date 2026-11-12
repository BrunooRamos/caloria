// Único archivo del repo que importa el SDK de Stripe (lo controla ESLint con no-restricted-imports).
import Stripe from "stripe";
import type { SubscriptionStatus } from "../../models/User";
import {
  BillingProviderError,
  InvalidWebhookSignatureError,
  type BillingProvider,
  type ProviderEvent,
  type ProviderSubscription,
} from "./provider";

export interface StripeBillingConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** Para los tests: apunta el SDK a otro host. */
  host?: string;
  port?: number;
  protocol?: "http" | "https";
}

const SIGNATURE_HEADER = "stripe-signature";
const TIMEOUT_MS = 10_000;

/** Eventos que cambian el estado de una suscripción. El resto se acepta y se ignora. */
const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function toStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "incomplete":
      return "incomplete";
    default:
      return "canceled"; // canceled, incomplete_expired
  }
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

function toSubscription(sub: Stripe.Subscription): ProviderSubscription {
  // Desde la API 2025-03-31 el período vive en cada item; hay un solo item (un precio).
  const periodEnd = sub.items.data[0]?.current_period_end;
  const customerId = idOf(sub.customer);
  if (!periodEnd || !customerId) {
    throw new BillingProviderError("Suscripción de Stripe sin período o sin cliente", {
      subscriptionId: sub.id,
    });
  }
  return {
    id: sub.id,
    customerId,
    status: toStatus(sub.status),
    currentPeriodEnd: new Date(periodEnd * 1000),
    // `cancel_at` cubre las cancelaciones programadas hechas desde el dashboard.
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at != null,
  };
}

/** Saca del error de Stripe solo lo que sirve para diagnosticar; nunca el `raw`. */
function stripeErrorDetail(err: unknown): Record<string, unknown> {
  if (!(err instanceof Stripe.errors.StripeError)) {
    return { name: err instanceof Error ? err.name : typeof err };
  }
  return {
    type: err.type,
    code: err.code,
    statusCode: err.statusCode,
    stripeRequestId: err.requestId,
    message: err.message,
  };
}

const isMissing = (err: unknown) =>
  err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing";

export function createStripeBillingProvider(config: StripeBillingConfig): BillingProvider {
  const stripe = new Stripe(config.secretKey, {
    maxNetworkRetries: 1,
    timeout: TIMEOUT_MS,
    ...(config.host && { host: config.host, port: config.port, protocol: config.protocol }),
  });

  async function call<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof BillingProviderError) throw err;
      throw new BillingProviderError(`Stripe falló en ${operation}`, stripeErrorDetail(err), {
        cause: err,
      });
    }
  }

  return {
    name: "stripe",

    createSubscription({ userId, customerId }) {
      return call("createSubscription", async () => {
        // Clave de idempotencia: dos altas seguidas del mismo usuario no crean dos clientes.
        const customer =
          customerId ??
          (
            await stripe.customers.create(
              { metadata: { userId } },
              { idempotencyKey: `customer-${userId}` },
            )
          ).id;
        // Checkout hosteado por Stripe: la tarjeta se carga ahí y nunca pasa por nuestra API.
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer,
          client_reference_id: userId,
          line_items: [{ price: config.priceId, quantity: 1 }],
          success_url: config.successUrl,
          cancel_url: config.cancelUrl,
          metadata: { userId },
          subscription_data: { metadata: { userId } },
        });
        if (!session.url) throw new BillingProviderError("Stripe no devolvió la URL del checkout");
        return { customerId: customer, checkoutUrl: session.url };
      });
    },

    getSubscription(subscriptionId) {
      return call("getSubscription", async () =>
        toSubscription(await stripe.subscriptions.retrieve(subscriptionId)),
      );
    },

    cancelAtPeriodEnd(subscriptionId) {
      return call("cancelAtPeriodEnd", async () =>
        toSubscription(
          await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }),
        ),
      );
    },

    resumeSubscription(subscriptionId) {
      return call("resumeSubscription", async () =>
        toSubscription(
          await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false }),
        ),
      );
    },

    deleteCustomer(customerId) {
      return call("deleteCustomer", async () => {
        try {
          await stripe.customers.del(customerId);
        } catch (err) {
          // Ya estaba borrado (un reintento del borrado de la cuenta): no queda nada que cancelar.
          if (isMissing(err)) return;
          throw err;
        }
      });
    },

    verifyWebhook(payload, headers) {
      const signature = headers[SIGNATURE_HEADER];
      if (typeof signature !== "string" || signature === "") {
        throw new InvalidWebhookSignatureError("Falta el header Stripe-Signature");
      }
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(payload, signature, config.webhookSecret);
      } catch {
        throw new InvalidWebhookSignatureError();
      }
      return toProviderEvent(event);
    },
  };
}

function toProviderEvent(event: Stripe.Event): ProviderEvent {
  const base = { id: event.id, type: event.type };
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const subscriptionId = idOf(session.subscription);
    const customerId = idOf(session.customer);
    if (session.mode === "subscription" && subscriptionId && customerId) {
      return { ...base, kind: "subscription", subscriptionId, customerId };
    }
    return { ...base, kind: "ignored" };
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = idOf(sub.customer);
    if (customerId) return { ...base, kind: "subscription", subscriptionId: sub.id, customerId };
  }
  return { ...base, kind: "ignored" };
}
