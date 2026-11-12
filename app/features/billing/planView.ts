/*
 * Qué muestra la pantalla de Tu plan en cada estado. Todo sale de la API: el plan de
 * `GET /billing/plan` y el precio, el cupo y lo que incluye cada plan del catálogo. Las fechas van
 * en la zona del usuario.
 *
 * Reglas de "sin pasos ocultos": antes de suscribirse se lee el precio con moneda y período, cuándo
 * se renueva y cómo se cancela; cancelar lleva los mismos pasos que suscribirse y el texto no
 * intenta convencer a nadie; quedarse sin análisis se dice con calma.
 */
import { shiftMonths, todayIn } from "@/features/history/day";
import type { BillingPlan, PlanCatalog, PlanOffer, Price } from "@/services/billing";
import {
  everyInterval,
  formatDay,
  formatInstantDay,
  formatPrice,
  formatPricePerInterval,
  nextChargeDay,
} from "./format";

/**
 * - `checking`: se cerró el checkout sin volver por la URL de éxito; se revisa un momento si pagó.
 * - `confirming`: volvió del checkout con el pago hecho; se espera el webhook que lo confirma.
 * - `slow`: la confirmación tarda más de lo normal.
 */
export type CheckoutStatus = "idle" | "checking" | "confirming" | "slow";

export interface PlanViewInput {
  plan: BillingPlan;
  catalog: PlanCatalog;
  checkout: CheckoutStatus;
  timeZone: string;
  now: Date;
}

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmTitle: string;
  cancelTitle: string;
}

/** Lo que hay que saber antes de tocar el botón, el botón y, si lleva diálogo, su texto. */
export type PlanAction =
  | { kind: "subscribe"; title: string; terms: string[] }
  | { kind: "cancel"; title: string; terms: string[]; confirm: ConfirmCopy; done: string }
  | { kind: "reactivate"; title: string; terms: string[]; confirm: ConfirmCopy; done: string };

export interface CurrentPlanView {
  /** Nombre del plan vigente, como lo da el catálogo; null mientras se confirma un pago. */
  label: string | null;
  headline: string;
  detail: string;
  /** Para la barra del free; null si no hay límite. */
  usage: { used: number; limit: number } | null;
}

export interface OfferView {
  tier: PlanOffer["tier"];
  name: string;
  price: string;
  quota: string;
  features: string[];
  current: boolean;
}

export type PlanView = {
  state: "free" | "premium" | "premiumEnding" | "checking" | "confirming" | "slow";
  current: CurrentPlanView;
  action: PlanAction | null;
  offers: OfferView[];
};

function offerOf(catalog: PlanCatalog, tier: PlanOffer["tier"]): PlanOffer {
  const offer = catalog.plans.find((plan) => plan.tier === tier);
  // El esquema del catálogo garantiza los dos planes.
  if (!offer) throw new Error(`Falta el plan ${tier} en el catálogo`);
  return offer;
}

/** El esquema del catálogo garantiza que el premium tiene precio. */
function premiumPrice(premium: PlanOffer): Price {
  if (!premium.price) throw new Error("El plan premium no tiene precio");
  return premium.price;
}

function quotaLabel(analysesPerMonth: number | null): string {
  return analysesPerMonth === null ? "Análisis ilimitados" : `${analysesPerMonth} análisis por mes`;
}

function offers(catalog: PlanCatalog, currentTier: PlanOffer["tier"]): OfferView[] {
  return catalog.plans.map((plan) => ({
    tier: plan.tier,
    name: plan.name,
    price: plan.price ? formatPricePerInterval(plan.price) : "Gratis",
    quota: quotaLabel(plan.analysesPerMonth),
    features: plan.features,
    current: plan.tier === currentTier,
  }));
}

function freeCurrent(
  plan: BillingPlan,
  free: PlanOffer,
  timeZone: string,
  now: Date,
): CurrentPlanView {
  const { limit, remaining, resetsOn } = plan.analyses;
  const resets = resetsOn ? `Se renuevan el ${formatDay(resetsOn, timeZone, now)}.` : "";
  if (limit === null || remaining === null) {
    return {
      label: free.name,
      headline: quotaLabel(free.analysesPerMonth),
      detail: resets,
      usage: null,
    };
  }
  const usage = { used: limit - remaining, limit };
  if (remaining === 0) {
    const { title, message } = quotaExhausted(plan, timeZone, now);
    return { label: free.name, headline: title, detail: message, usage };
  }
  return {
    label: free.name,
    headline: `Te ${remaining === 1 ? "queda" : "quedan"} ${remaining} de ${limit} análisis este mes`,
    detail: resets,
    usage,
  };
}

function subscribeAction(premium: PlanOffer, timeZone: string, now: Date): PlanAction {
  const price = premiumPrice(premium);
  return {
    kind: "subscribe",
    title: `Suscribirme por ${formatPricePerInterval(price)}`,
    terms: [
      `Se cobran ${formatPrice(price)} hoy y la suscripción se renueva sola ${everyInterval(price.interval)}: el próximo cobro es el ${nextChargeDay(price.interval, timeZone, now)}.`,
      "Podés cancelarla cuando quieras desde esta pantalla. Seguís con premium hasta el final del período que pagaste y no se te cobra más.",
    ],
  };
}

const CHECKOUT_COPY: Record<
  Exclude<CheckoutStatus, "idle">,
  { headline: string; detail: string }
> = {
  checking: {
    headline: "Revisando si se completó el pago",
    detail: "Es un momento.",
  },
  confirming: {
    headline: "Estamos confirmando tu pago",
    detail: "Puede tardar unos segundos. No hace falta que pagues de nuevo.",
  },
  slow: {
    headline: "Todavía no nos llegó la confirmación del pago",
    detail:
      "A veces tarda unos minutos. Si pagaste, no hace falta pagar de nuevo: tu plan se actualiza solo.",
  },
};

export function planView({ plan, catalog, checkout, timeZone, now }: PlanViewInput): PlanView {
  const free = offerOf(catalog, "free");
  const premium = offerOf(catalog, "premium");
  const price = premiumPrice(premium);

  if (plan.tier === "free" && checkout !== "idle") {
    return {
      state: checkout,
      current: { label: null, ...CHECKOUT_COPY[checkout], usage: null },
      action: null,
      offers: offers(catalog, "free"),
    };
  }

  if (plan.tier === "free") {
    return {
      state: "free",
      current: freeCurrent(plan, free, timeZone, now),
      action: subscribeAction(premium, timeZone, now),
      offers: offers(catalog, "free"),
    };
  }

  const unlimited = quotaLabel(premium.analysesPerMonth);
  if (plan.periodEnd === null) {
    // Alta manual, sin proveedor: no vence ni hay nada que cancelar.
    return {
      state: "premium",
      current: {
        label: premium.name,
        headline: unlimited,
        detail: "Tu plan premium no tiene fecha de vencimiento.",
        usage: null,
      },
      action: null,
      offers: offers(catalog, "premium"),
    };
  }

  const end = formatInstantDay(plan.periodEnd, timeZone, now);
  const freeQuota = quotaLabel(free.analysesPerMonth);

  if (plan.renews) {
    return {
      state: "premium",
      current: {
        label: premium.name,
        headline: unlimited,
        detail: `Se renueva el ${end} por ${formatPrice(price)}.`,
        usage: null,
      },
      action: {
        kind: "cancel",
        title: "Cancelar suscripción",
        terms: [
          `Si cancelás, seguís con premium hasta el ${end}. Después pasás al plan free, con ${freeQuota}, y no se te cobra más.`,
        ],
        confirm: {
          title: "¿Cancelar la suscripción?",
          message: `Seguís con premium hasta el ${end}. Después pasás al plan free y no se te cobra más.`,
          confirmTitle: "Cancelar suscripción",
          cancelTitle: "Volver",
        },
        done: `Cancelaste la suscripción. Seguís con premium hasta el ${end}.`,
      },
      offers: offers(catalog, "premium"),
    };
  }

  const renewal = `se renueva el ${end} por ${formatPrice(price)} y después ${everyInterval(price.interval)}. Hoy no se cobra nada.`;
  return {
    state: "premiumEnding",
    current: {
      label: premium.name,
      headline: `${premium.name} hasta el ${end}`,
      detail: `Cancelaste la suscripción: no se renueva ni se te cobra más. Desde el ${end} pasás al plan free, con ${freeQuota}.`,
      usage: null,
    },
    action: {
      kind: "reactivate",
      title: "Volver a activar la suscripción",
      terms: [
        `Si la volvés a activar, ${renewal}`,
        "Podés cancelarla de nuevo cuando quieras desde esta pantalla.",
      ],
      confirm: {
        title: "¿Volver a activar la suscripción?",
        message: `La suscripción ${renewal}`,
        confirmTitle: "Activar",
        cancelTitle: "Volver",
      },
      done: `Listo: tu suscripción se renueva el ${end}.`,
    },
    offers: offers(catalog, "premium"),
  };
}

/** Si se puede registrar una comida: premium no tiene cupo; free, mientras le quede alguno. */
export function hasAnalysesLeft(plan: BillingPlan): boolean {
  const { remaining } = plan.analyses;
  return remaining === null || remaining > 0;
}

/** Sin análisis en el mes: lo dice con calma, con cuándo se renuevan y qué sigue disponible. */
function quotaExhausted(
  plan: BillingPlan,
  timeZone: string,
  now: Date,
): { title: string; message: string } {
  const { limit, resetsOn } = plan.analyses;
  return {
    title:
      limit === null
        ? "Usaste los análisis de este mes"
        : `Usaste los ${limit} análisis de este mes`,
    message: [
      resetsOn && `Se renuevan el ${formatDay(resetsOn, timeZone, now)}.`,
      "Tu historial y tus metas siguen disponibles.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export interface QuotaView {
  title: string;
  message: string;
  /** Lo único que dice la hoja sin pagos (build de Google Play): cuántos usó y cuándo vuelven. */
  renewal: string;
  /** Para la barra; null si el plan no tiene límite. */
  usage: { used: number; limit: number } | null;
}

/** El aviso de "Registrar" cuando no quedan análisis: lo mismo que dice la tarjeta de Tu plan. */
export function quotaView(plan: BillingPlan, timeZone: string, now: Date): QuotaView {
  const { limit, remaining } = plan.analyses;
  return {
    ...quotaExhausted(plan, timeZone, now),
    renewal: quotaRenewal(plan, timeZone, now),
    usage: limit === null || remaining === null ? null : { used: limit - remaining, limit },
  };
}

/** "1.º de diciembre": el día en que se renuevan los análisis (el 1.º del mes que viene). */
function renewalDay(resetsOn: string | null, timeZone: string, now: Date): string {
  const today = todayIn(timeZone, now);
  const day = resetsOn ?? `${shiftMonths(today, 1).slice(0, 7)}-01`;
  return formatDay(day, timeZone, now).replace(/^1 de /, "1.º de ");
}

/** Sin pagos: "Usaste tus 40 análisis del mes. Se renuevan el 1.º de diciembre." */
export function quotaRenewal(plan: BillingPlan, timeZone: string, now: Date): string {
  const { limit, resetsOn } = plan.analyses;
  const used =
    limit === null ? "Usaste tus análisis del mes." : `Usaste tus ${limit} análisis del mes.`;
  return `${used} Se renuevan el ${renewalDay(resetsOn, timeZone, now)}.`;
}

/** La fila "Tu plan" sin pagos: solo el uso del mes, "12 de 40 análisis". */
export function usageSummary(plan: BillingPlan): string {
  const { limit, remaining } = plan.analyses;
  if (limit === null || remaining === null) return "Análisis ilimitados";
  return `${limit - remaining} de ${limit} análisis`;
}

/** El resumen de la fila "Tu plan" del perfil: "Free · te quedan 37 análisis". */
export function planSummary(plan: BillingPlan, timeZone: string, now: Date): string {
  if (plan.tier === "premium") {
    if (plan.periodEnd === null) return "Premium";
    const end = formatInstantDay(plan.periodEnd, timeZone, now);
    return plan.renews ? `Premium · se renueva el ${end}` : `Premium hasta el ${end}`;
  }
  const { limit, remaining } = plan.analyses;
  if (remaining === null || limit === null) return "Free";
  if (remaining === 0) return `Free · usaste los ${limit} de este mes`;
  return `Free · te ${remaining === 1 ? "queda 1 análisis" : `quedan ${remaining} análisis`}`;
}
