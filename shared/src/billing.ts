/** Ruta del webhook del proveedor de pagos. Es pública y el body se reenvía crudo (la firma va sobre los bytes). */
export const BILLING_WEBHOOK_PATH = "/api/v1/billing/webhook";

/** Tope del body del webhook, igual que el de cualquier JSON de la API. */
export const BILLING_WEBHOOK_BODY_LIMIT = "100kb";

/** Headers del webhook que el Front reenvía al Backend: los de firma del proveedor (`Stripe-Signature`, …). */
export const WEBHOOK_SIGNATURE_HEADER = /signature$/i;

export interface BillingPlanResponse {
  /** Plan efectivo: premium solo si el período pagado no terminó. */
  tier: "free" | "premium";
  /** Fin del período pagado del premium (ISO 8601); null en free. */
  periodEnd: string | null;
  /** true: se renueva en `periodEnd`. false: termina ahí (canceló) o no hay nada que renovar. */
  renews: boolean;
  analyses: {
    /** null en premium: sin límite. */
    limit: number | null;
    remaining: number | null;
    /** Día en que se reinicia el cupo free ("YYYY-MM-DD"); null en premium. */
    resetsOn: string | null;
  };
}

export type SubscribeResponse =
  | { action: "checkout"; checkoutUrl: string; plan: BillingPlanResponse }
  | { action: "reactivated"; plan: BillingPlanResponse };
