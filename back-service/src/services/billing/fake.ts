import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BillingProviderError,
  InvalidWebhookSignatureError,
  type BillingProvider,
  type ProviderEvent,
  type ProviderSubscription,
} from "./provider";

const SIGNATURE_HEADER = "x-fake-signature";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SignedWebhook {
  body: string;
  headers: Record<string, string>;
}

interface FakeEventBody {
  id: string;
  type: string;
  subscriptionId?: string;
  customerId?: string;
}

export function createFakeBillingProvider({
  webhookSecret = "fake-webhook-secret",
  now = () => new Date(),
}: { webhookSecret?: string; now?: () => Date } = {}) {
  const subscriptions = new Map<string, ProviderSubscription>();
  const checkouts: { customerId: string; userId: string }[] = [];
  const calls: string[] = [];
  let down = false;
  let seq = 0;

  const nextId = (prefix: string) => `${prefix}_fake_${++seq}`;

  function guard(operation: string) {
    calls.push(operation);
    if (down) {
      throw new BillingProviderError(`Proveedor falso caído en ${operation}`, {
        type: "connection_error",
      });
    }
  }

  function existing(subscriptionId: string): ProviderSubscription {
    const sub = subscriptions.get(subscriptionId);
    if (!sub) throw new BillingProviderError("Suscripción inexistente", { subscriptionId });
    return sub;
  }

  function sign(body: string): string {
    return createHmac("sha256", webhookSecret).update(body).digest("hex");
  }

  function webhook(event: FakeEventBody): SignedWebhook {
    const body = JSON.stringify(event);
    return {
      body,
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(body) },
    };
  }

  function subscriptionEvent(type: string, sub: ProviderSubscription): SignedWebhook {
    return webhook({
      id: nextId("evt"),
      type,
      subscriptionId: sub.id,
      customerId: sub.customerId,
    });
  }

  const provider: BillingProvider = {
    name: "fake",

    async createSubscription({ userId, customerId }) {
      guard("createSubscription");
      const customer = customerId ?? nextId("cus");
      checkouts.push({ customerId: customer, userId });
      return { customerId: customer, checkoutUrl: `https://checkout.fake.test/${nextId("cs")}` };
    },

    async getSubscription(subscriptionId) {
      guard("getSubscription");
      return { ...existing(subscriptionId) };
    },

    async cancelAtPeriodEnd(subscriptionId) {
      guard("cancelAtPeriodEnd");
      const sub = existing(subscriptionId);
      sub.cancelAtPeriodEnd = true;
      return { ...sub };
    },

    async resumeSubscription(subscriptionId) {
      guard("resumeSubscription");
      const sub = existing(subscriptionId);
      sub.cancelAtPeriodEnd = false;
      return { ...sub };
    },

    verifyWebhook(payload, headers): ProviderEvent {
      const signature = headers[SIGNATURE_HEADER];
      if (typeof signature !== "string") throw new InvalidWebhookSignatureError();
      const expected = Buffer.from(sign(payload.toString("utf8")));
      const received = Buffer.from(signature);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new InvalidWebhookSignatureError();
      }
      const event = JSON.parse(payload.toString("utf8")) as FakeEventBody;
      if (event.subscriptionId && event.customerId) {
        return {
          id: event.id,
          type: event.type,
          kind: "subscription",
          subscriptionId: event.subscriptionId,
          customerId: event.customerId,
        };
      }
      return { id: event.id, type: event.type, kind: "ignored" };
    },
  };

  return {
    provider,
    subscriptions,
    checkouts,
    calls,
    setDown(value: boolean) {
      down = value;
    },
    /** El usuario pagó en el checkout: el proveedor crea la suscripción y manda el webhook. */
    completeCheckout(customerId: string, periodDays = 30): SignedWebhook {
      const sub: ProviderSubscription = {
        id: nextId("sub"),
        customerId,
        status: "active",
        currentPeriodEnd: new Date(now().getTime() + periodDays * DAY_MS),
        cancelAtPeriodEnd: false,
      };
      subscriptions.set(sub.id, sub);
      return subscriptionEvent("checkout.session.completed", sub);
    },
    /** El proveedor terminó la suscripción (fin del período de una cancelada). */
    endSubscription(subscriptionId: string): SignedWebhook {
      const sub = existing(subscriptionId);
      sub.status = "canceled";
      return subscriptionEvent("customer.subscription.deleted", sub);
    },
    /** Renovación cobrada: el período avanza. */
    renew(subscriptionId: string, periodDays = 30): SignedWebhook {
      const sub = existing(subscriptionId);
      sub.currentPeriodEnd = new Date(sub.currentPeriodEnd.getTime() + periodDays * DAY_MS);
      return subscriptionEvent("customer.subscription.updated", sub);
    },
    /** Evento que no nos interesa (ej. invoice.created). */
    otherEvent(type = "invoice.created"): SignedWebhook {
      return webhook({ id: nextId("evt"), type });
    },
    webhook,
  };
}

export type FakeBilling = ReturnType<typeof createFakeBillingProvider>;
