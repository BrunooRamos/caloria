/*
 * FIXTURE PROVISORIO: reemplaza a `GET /billing/plans` hasta que exista (ver getPlanCatalog en
 * billing.ts). El precio no está definido (decisión abierta 5) y lo que ve el free del Wrapped
 * tampoco (decisión abierta 4): estos valores son de ejemplo. El cupo free coincide con
 * FREE_MONTHLY_ANALYSES del Backend. No importar desde ningún otro lado.
 */
export const PLANS_FIXTURE: unknown = {
  plans: [
    {
      tier: "free",
      name: "Free",
      price: null,
      analysesPerMonth: 40,
      features: ["Historial, metas diarias y racha", "Comentario de cada comida"],
    },
    {
      tier: "premium",
      name: "Premium",
      price: { amount: 499, currency: "USD", interval: "month" },
      analysesPerMonth: null,
      features: ["Wrapped completo cada semana", "Todo lo del plan free"],
    },
  ],
};
