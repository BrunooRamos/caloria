import type { Plan } from "../models/User";

/**
 * Margen para una suscripción que se renueva: al terminar el período el proveedor cobra y avisa por
 * webhook unos minutos u horas después. Sin margen, el usuario quedaría free en ese hueco. Si el
 * cobro falla, `currentPeriodEnd` no avanza y el usuario vuelve a free al pasar el margen.
 * Una suscripción cancelada no tiene margen: termina justo en `currentPeriodEnd`.
 */
export const RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000;

type PlanState = Pick<Plan, "tier" | "currentPeriodEnd" | "cancelAtPeriodEnd">;

/**
 * Única fuente de verdad de "es premium": la usan requirePremium, el cupo, GET /billing/plan,
 * GET /users/me y el claim `plan` del JWT. Nunca comparar `plan.tier` directamente.
 *
 * Premium = tier premium y el período pagado no terminó. Sin `currentPeriodEnd` (alta manual, sin
 * proveedor) no vence. Si se pierde el webhook de fin de suscripción, igual vuelve a free solo.
 */
export function isPremium(plan: PlanState | undefined, now: Date): boolean {
  if (plan?.tier !== "premium") return false;
  if (!plan.currentPeriodEnd) return true;
  const grace = plan.cancelAtPeriodEnd ? 0 : RENEWAL_GRACE_MS;
  return now.getTime() < plan.currentPeriodEnd.getTime() + grace;
}

export function effectiveTier(plan: PlanState | undefined, now: Date): "free" | "premium" {
  return isPremium(plan, now) ? "premium" : "free";
}
