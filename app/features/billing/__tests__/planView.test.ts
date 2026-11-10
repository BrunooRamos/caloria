import type { BillingPlan, PlanCatalog } from "@/services/billing";
import { planSummary, planView } from "../planView";
import type { CheckoutStatus, PlanView } from "../planView";

const TZ = "America/Montevideo";
const NOW = new Date("2026-11-09T15:00:00.000Z");

const CATALOG: PlanCatalog = {
  plans: [
    {
      tier: "free",
      name: "Free",
      price: null,
      analysesPerMonth: 40,
      features: ["Historial, metas diarias y racha"],
    },
    {
      tier: "premium",
      name: "Premium",
      price: { amount: 499, currency: "USD", interval: "month" },
      analysesPerMonth: null,
      features: ["Wrapped completo cada semana"],
    },
  ],
};

const free = (remaining = 37): BillingPlan => ({
  tier: "free",
  periodEnd: null,
  renews: false,
  analyses: { limit: 40, remaining, resetsOn: "2026-12-01" },
});

const premium = ({
  renews = true,
  periodEnd = "2026-12-04T15:00:00.000Z" as string | null,
} = {}): BillingPlan => ({
  tier: "premium",
  periodEnd,
  renews,
  analyses: { limit: null, remaining: null, resetsOn: null },
});

const view = (
  plan: BillingPlan,
  {
    checkout = "idle",
    catalog = CATALOG,
    timeZone = TZ,
  }: {
    checkout?: CheckoutStatus;
    catalog?: PlanCatalog;
    timeZone?: string;
  } = {},
) => planView({ plan, catalog, checkout, timeZone, now: NOW });

/** Todo el texto que se lee en la pantalla, para revisar el tono. */
function allText({ current, action }: PlanView): string[] {
  const texts = [current.label ?? "", current.headline, current.detail];
  if (action) {
    texts.push(action.title, ...action.terms);
    if (action.kind !== "subscribe") texts.push(...Object.values(action.confirm), action.done);
  }
  return texts;
}

describe("free", () => {
  it("lo que queda del mes y cuándo se renueva, con la barra de lo usado", () => {
    const { state, current } = view(free(37));
    expect(state).toBe("free");
    expect(current).toEqual({
      label: "Free",
      headline: "Te quedan 37 de 40 análisis este mes",
      detail: "Se renuevan el 1 de diciembre.",
      usage: { used: 3, limit: 40 },
    });
  });

  it("en singular cuando queda uno", () => {
    expect(view(free(1)).current.headline).toBe("Te queda 1 de 40 análisis este mes");
  });

  it("sin análisis: lo dice con calma y no cambia la oferta para apurar", () => {
    const exhausted = view(free(0));
    expect(exhausted.current).toEqual({
      label: "Free",
      headline: "Usaste los 40 análisis de este mes",
      detail: "Se renuevan el 1 de diciembre. Tu historial y tus metas siguen disponibles.",
      usage: { used: 40, limit: 40 },
    });
    expect(exhausted.action).toEqual(view(free(37)).action);
    for (const text of allText(exhausted)) {
      expect(text).not.toMatch(/!|urgente|ahora mismo|últim|no te quedes|se acab/i);
    }
  });

  it("antes de suscribirse: precio con moneda y período, cuándo se renueva y cómo se cancela", () => {
    const { action } = view(free());
    expect(action).toEqual({
      kind: "subscribe",
      title: "Suscribirme por US$ 4,99 por mes",
      terms: [
        "Se cobran US$ 4,99 hoy y la suscripción se renueva sola cada mes: el próximo cobro es el 9 de diciembre.",
        "Podés cancelarla cuando quieras desde esta pantalla. Seguís con premium hasta el final del período que pagaste y no se te cobra más.",
      ],
    });
  });

  it("qué incluye cada plan, con el suyo marcado", () => {
    expect(view(free()).offers).toEqual([
      {
        tier: "free",
        name: "Free",
        price: "Gratis",
        quota: "40 análisis por mes",
        features: ["Historial, metas diarias y racha"],
        current: true,
      },
      {
        tier: "premium",
        name: "Premium",
        price: "US$ 4,99 por mes",
        quota: "Análisis ilimitados",
        features: ["Wrapped completo cada semana"],
        current: false,
      },
    ]);
  });

  it("el precio, el cupo y lo que incluye salen del catálogo de la API", () => {
    const catalog: PlanCatalog = {
      plans: [
        { tier: "free", name: "Básico", price: null, analysesPerMonth: 25, features: [] },
        {
          tier: "premium",
          name: "Pro",
          price: { amount: 129000, currency: "UYU", interval: "year" },
          analysesPerMonth: 500,
          features: ["Otra cosa"],
        },
      ],
    };
    const result = view(premium({ renews: false }), { catalog });
    expect(result.current.headline).toBe("Pro hasta el 4 de diciembre");
    expect(result.current.detail).toContain("pasás al plan free, con 25 análisis por mes.");
    expect(result.offers.map((offer) => [offer.name, offer.price, offer.quota])).toEqual([
      ["Básico", "Gratis", "25 análisis por mes"],
      ["Pro", "$U 1.290 por año", "500 análisis por mes"],
    ]);

    const subscribe = view(free(), { catalog }).action;
    expect(subscribe?.title).toBe("Suscribirme por $U 1.290 por año");
    expect(subscribe?.terms[0]).toBe(
      "Se cobran $U 1.290 hoy y la suscripción se renueva sola cada año: el próximo cobro es el 9 de noviembre de 2027.",
    );
  });
});

describe("premium", () => {
  it("se renueva: la fecha y el precio, y cancelar a la vista", () => {
    const result = view(premium());
    expect(result.state).toBe("premium");
    expect(result.current).toEqual({
      label: "Premium",
      headline: "Análisis ilimitados",
      detail: "Se renueva el 4 de diciembre por US$ 4,99.",
      usage: null,
    });
    expect(result.action).toEqual({
      kind: "cancel",
      title: "Cancelar suscripción",
      terms: [
        "Si cancelás, seguís con premium hasta el 4 de diciembre. Después pasás al plan free, con 40 análisis por mes, y no se te cobra más.",
      ],
      confirm: {
        title: "¿Cancelar la suscripción?",
        message:
          "Seguís con premium hasta el 4 de diciembre. Después pasás al plan free y no se te cobra más.",
        confirmTitle: "Cancelar suscripción",
        cancelTitle: "Volver",
      },
      done: "Cancelaste la suscripción. Seguís con premium hasta el 4 de diciembre.",
    });
    expect(result.offers.map((offer) => offer.current)).toEqual([false, true]);
  });

  it("el texto para cancelar no intenta convencer ni hacer sentir culpa", () => {
    for (const text of allText(view(premium()))) {
      expect(text).not.toMatch(
        /segur[oa]|de verdad|perd[eé]s|extrañ|lástima|triste|te vas|no te vayas|oferta|descuento|!/i,
      );
    }
  });

  it("cancelado pero vigente: hasta cuándo sigue y que no se cobra más", () => {
    const result = view(premium({ renews: false }));
    expect(result.state).toBe("premiumEnding");
    expect(result.current).toEqual({
      label: "Premium",
      headline: "Premium hasta el 4 de diciembre",
      detail:
        "Cancelaste la suscripción: no se renueva ni se te cobra más. Desde el 4 de diciembre pasás al plan free, con 40 análisis por mes.",
      usage: null,
    });
  });

  it("cancelado pero vigente: volver a activarla dice cuándo y cuánto se cobra antes de confirmar", () => {
    expect(view(premium({ renews: false })).action).toEqual({
      kind: "reactivate",
      title: "Volver a activar la suscripción",
      terms: [
        "Si la volvés a activar, se renueva el 4 de diciembre por US$ 4,99 y después cada mes. Hoy no se cobra nada.",
        "Podés cancelarla de nuevo cuando quieras desde esta pantalla.",
      ],
      confirm: {
        title: "¿Volver a activar la suscripción?",
        message:
          "La suscripción se renueva el 4 de diciembre por US$ 4,99 y después cada mes. Hoy no se cobra nada.",
        confirmTitle: "Activar",
        cancelTitle: "Volver",
      },
      done: "Listo: tu suscripción se renueva el 4 de diciembre.",
    });
  });

  it("sin fecha de fin (alta manual): no vence ni hay nada que cancelar", () => {
    const result = view(premium({ periodEnd: null, renews: false }));
    expect(result.state).toBe("premium");
    expect(result.current.detail).toBe("Tu plan premium no tiene fecha de vencimiento.");
    expect(result.action).toBeNull();
  });

  it("la fecha es la del día en la zona del usuario", () => {
    const lateUtc = premium({ periodEnd: "2026-12-01T02:00:00.000Z" });
    expect(view(lateUtc).current.detail).toBe("Se renueva el 30 de noviembre por US$ 4,99.");
    expect(view(lateUtc, { timeZone: "UTC" }).current.detail).toBe(
      "Se renueva el 1 de diciembre por US$ 4,99.",
    );
  });
});

describe("pago confirmándose", () => {
  it("después de pagar: espera la confirmación sin botón de pagar (no hay forma de pagar dos veces)", () => {
    const result = view(free(), { checkout: "confirming" });
    expect(result.state).toBe("confirming");
    expect(result.current).toEqual({
      label: null,
      headline: "Estamos confirmando tu pago",
      detail: "Puede tardar unos segundos. No hace falta que pagues de nuevo.",
      usage: null,
    });
    expect(result.action).toBeNull();
    expect(result.offers).toHaveLength(2);
  });

  it("si tarda, lo dice sin tono de error", () => {
    const result = view(free(), { checkout: "slow" });
    expect(result.state).toBe("slow");
    expect(result.current.headline).toBe("Todavía no nos llegó la confirmación del pago");
    expect(result.current.detail).toBe(
      "A veces tarda unos minutos. Si pagaste, no hace falta pagar de nuevo: tu plan se actualiza solo.",
    );
    expect(allText(result).join(" ")).not.toMatch(/error|falló|fallo|rechaz/i);
    expect(result.action).toBeNull();
  });

  it("si cerró el pago sin volver por la URL de éxito, revisa un momento", () => {
    const result = view(free(), { checkout: "checking" });
    expect(result.state).toBe("checking");
    expect(result.current.headline).toBe("Revisando si se completó el pago");
    expect(result.action).toBeNull();
  });

  it("cuando llega la confirmación, muestra premium aunque siga esperando", () => {
    expect(view(premium(), { checkout: "confirming" }).state).toBe("premium");
  });
});

describe("planSummary (la fila del perfil)", () => {
  it.each<[string, BillingPlan, string]>([
    ["free", free(37), "Free · te quedan 37 análisis"],
    ["free con uno", free(1), "Free · te queda 1 análisis"],
    ["free sin análisis", free(0), "Free · usaste los 40 de este mes"],
    ["premium", premium(), "Premium · se renueva el 4 de diciembre"],
    ["premium cancelado vigente", premium({ renews: false }), "Premium hasta el 4 de diciembre"],
    ["premium sin fecha", premium({ periodEnd: null, renews: false }), "Premium"],
  ])("%s → %s", (_, plan, expected) => {
    expect(planSummary(plan, TZ, NOW)).toBe(expected);
  });
});
