import { z } from "zod";
import { api } from "./api";
import { PLANS_FIXTURE } from "./billing-plans.fixture";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const tier = z.enum(["free", "premium"]);

/** Espejo de `BillingPlanResponse` en `@caloria/shared` (docs/api.md, "Ver el plan"). */
const billingPlanSchema = z.object({
  tier,
  periodEnd: z.iso.datetime({ offset: true }).nullable(),
  renews: z.boolean(),
  analyses: z.object({
    limit: z.number().int().nonnegative().nullable(),
    remaining: z.number().int().nonnegative().nullable(),
    resetsOn: day.nullable(),
  }),
});

/** `GET /billing/plan`: plan efectivo, fin del período pagado y análisis restantes del mes. */
export type BillingPlan = z.infer<typeof billingPlanSchema>;

const subscribeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkout"), checkoutUrl: z.url(), plan: billingPlanSchema }),
  z.object({ action: z.literal("reactivated"), plan: billingPlanSchema }),
]);

export type SubscribeResponse = z.infer<typeof subscribeSchema>;

const priceSchema = z.object({
  /** En la unidad mínima de la moneda (centavos), como la da el proveedor. */
  amount: z.number().int().positive(),
  /** ISO 4217: `USD`, `UYU`. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  interval: z.enum(["month", "year"]),
});

const planOfferSchema = z.object({
  tier,
  name: z.string().min(1),
  /** null: gratis. */
  price: priceSchema.nullable(),
  /** null: sin límite. */
  analysesPerMonth: z.number().int().positive().nullable(),
  /** Qué incluye, además de los análisis; los textos los define la API. */
  features: z.array(z.string().min(1)),
});

const catalogSchema = z
  .object({ plans: z.array(planOfferSchema) })
  .refine(
    ({ plans }) =>
      plans.some((plan) => plan.tier === "free") &&
      plans.some((plan) => plan.tier === "premium" && plan.price !== null),
    { message: "El catálogo tiene que traer el plan free y el premium con precio" },
  );

export type Price = z.infer<typeof priceSchema>;
export type PlanOffer = z.infer<typeof planOfferSchema>;
/** Los planes que se pueden contratar: precio, cupo y qué incluye cada uno. */
export type PlanCatalog = z.infer<typeof catalogSchema>;

export async function getBillingPlan(signal?: AbortSignal): Promise<BillingPlan> {
  return billingPlanSchema.parse(await api.get<unknown>("/billing/plan", { signal }));
}

/** Devuelve el checkout del proveedor, o reactiva una suscripción cancelada que sigue vigente. */
export async function subscribe(): Promise<SubscribeResponse> {
  return subscribeSchema.parse(await api.post<unknown>("/billing/subscribe"));
}

/** Cancela al fin del período pagado: el plan sigue premium hasta `periodEnd`. */
export async function cancelSubscription(): Promise<BillingPlan> {
  return billingPlanSchema.parse(await api.post<unknown>("/billing/cancel"));
}

/**
 * Catálogo de planes. Todavía no hay endpoint (se propone `GET /billing/plans`): sale de un fixture
 * con la misma forma. Para sacarlo, esto pasa a ser
 * `catalogSchema.parse(await api.get<unknown>("/billing/plans", { signal }))` y se borra
 * billing-plans.fixture.ts.
 */
export async function getPlanCatalog(_signal?: AbortSignal): Promise<PlanCatalog> {
  return catalogSchema.parse(await Promise.resolve(PLANS_FIXTURE));
}
