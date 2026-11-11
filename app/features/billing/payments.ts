import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { cancelSubscription, subscribe } from "@/services/billing";
import type { BillingPlan } from "@/services/billing";

/**
 * Cómo terminó el intento de suscribirse:
 * - `confirming`: pagó; el plan pasa a premium cuando llega la confirmación del proveedor.
 * - `reactivated`: tenía una suscripción cancelada todavía vigente y se volvió a activar, sin cobro.
 * - `closed`: cerró el pago sin que sepamos cómo terminó (puede haber pagado igual).
 * - `cancelled`: volvió sin pagar.
 */
export type SubscribeOutcome =
  | { kind: "confirming" }
  | { kind: "reactivated"; plan: BillingPlan }
  | { kind: "closed" }
  | { kind: "cancelled" };

/**
 * La pantalla de Tu plan solo conoce esta interfaz. Hoy la implementa el checkout web de Stripe;
 * para publicar en las tiendas, otra implementación con las compras integradas de Apple y Google
 * reemplaza a `paymentGateway` sin tocar la pantalla.
 */
export interface PaymentGateway {
  /** Dónde se paga, para decirlo antes de suscribirse. */
  readonly paymentNote: string;
  subscribe(): Promise<SubscribeOutcome>;
  /** Cancela al fin del período pagado y devuelve cómo quedó el plan. */
  cancel(): Promise<BillingPlan>;
}

/** Adonde vuelve el checkout: `caloria://billing/return?result=success` (o `cancel`). */
export const CHECKOUT_RETURN_PATH = "billing/return";

export function checkoutReturnUrl(): string {
  return Linking.createURL(CHECKOUT_RETURN_PATH);
}

/** El `result` de la URL de vuelta del checkout; null si no lo trae o no es ninguno de los dos. */
export function checkoutResult(url: string): "success" | "cancel" | null {
  const result = /[?&]result=([^&#]*)/.exec(url)?.[1];
  return result === "success" || result === "cancel" ? result : null;
}

/** Checkout hosteado por Stripe, en el navegador del sistema. Vuelve por deep link. */
export const stripeCheckout: PaymentGateway = {
  paymentNote:
    "El pago se hace en una página segura de Stripe: la app no ve ni guarda los datos de tu tarjeta.",
  async subscribe() {
    const response = await subscribe();
    if (response.action === "reactivated") return { kind: "reactivated", plan: response.plan };
    const session = await WebBrowser.openAuthSessionAsync(
      response.checkoutUrl,
      checkoutReturnUrl(),
    );
    if (session.type !== "success") return { kind: "closed" };
    switch (checkoutResult(session.url)) {
      case "success":
        return { kind: "confirming" };
      case "cancel":
        return { kind: "cancelled" };
      default:
        return { kind: "closed" };
    }
  },
  cancel: cancelSubscription,
};

export const paymentGateway: PaymentGateway = stripeCheckout;
