import { AiUsageModel } from "../models/AiUsage";
import type { AiCallKind } from "../models/AiUsage";
import { MealModel } from "../models/Meal";

export interface CostLine {
  calls: number;
  costUsd: number;
}

export interface MonthlyAiCosts {
  month: string; // "YYYY-MM", en UTC
  calls: number;
  costUsd: number;
  /** Llamadas de un modelo sin precio en config/ai-pricing: no suman al costo. */
  unpricedCalls: number;
  byKind: Partial<Record<AiCallKind, CostLine>>;
  byModel: Record<string, CostLine>;
  /** Usuarios con al menos una comida registrada en el mes. */
  activeUsers: number;
  /** costUsd / activeUsers; null sin usuarios activos. */
  costPerActiveUserUsd: number | null;
  /** Comidas del mes cuyo análisis salió de la cache, sin llamar a la IA. */
  cachedAnalyses: number;
}

/** "2026-11" → [2026-11-01T00:00Z, 2026-12-01T00:00Z). */
export function monthRange(month: string): { from: Date; to: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`El mes tiene que ser YYYY-MM (vino "${month}")`);
  }
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, monthNumber - 1, 1)),
    to: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

/** Lo gastado en IA en el mes (UTC) y el promedio por usuario activo (RNF-07). */
export async function monthlyAiCosts(month: string): Promise<MonthlyAiCosts> {
  const { from, to } = monthRange(month);
  const inMonth = { $gte: from, $lt: to };

  const [groups, activeUserIds, cachedAnalyses] = await Promise.all([
    AiUsageModel.aggregate<{
      _id: { kind: AiCallKind; model: string };
      calls: number;
      costUsd: number;
      unpriced: number;
    }>([
      { $match: { at: inMonth } },
      {
        $group: {
          _id: { kind: "$kind", model: "$model" },
          calls: { $sum: 1 },
          costUsd: { $sum: { $ifNull: ["$costUsd", 0] } },
          unpriced: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$costUsd", null] }, null] }, 1, 0] } },
        },
      },
    ]),
    MealModel.distinct("userId", { capturedAt: inMonth }),
    MealModel.countDocuments({ capturedAt: inMonth, cachedFrom: { $exists: true } }),
  ]);

  const byKind: MonthlyAiCosts["byKind"] = {};
  const byModel: MonthlyAiCosts["byModel"] = {};
  let calls = 0;
  let costUsd = 0;
  let unpricedCalls = 0;
  for (const group of groups) {
    const { kind, model } = group._id;
    calls += group.calls;
    costUsd += group.costUsd;
    unpricedCalls += group.unpriced;
    for (const [table, key] of [
      [byKind, kind],
      [byModel, model],
    ] as const) {
      const line = ((table as Record<string, CostLine>)[key] ??= { calls: 0, costUsd: 0 });
      line.calls += group.calls;
      line.costUsd += group.costUsd;
    }
  }
  const activeUsers = activeUserIds.length;
  return {
    month,
    calls,
    costUsd,
    unpricedCalls,
    byKind,
    byModel,
    activeUsers,
    costPerActiveUserUsd: activeUsers > 0 ? costUsd / activeUsers : null,
    cachedAnalyses,
  };
}

const usd = (value: number) => `US$ ${value.toFixed(4)}`;

/** El resumen como texto para la terminal. */
export function formatMonthlyAiCosts(report: MonthlyAiCosts): string {
  const table = (title: string, lines: Record<string, CostLine>) => [
    title,
    ...Object.entries(lines)
      .sort(([, a], [, b]) => b.costUsd - a.costUsd)
      .map(
        ([name, line]) =>
          `  ${name.padEnd(16)} ${String(line.calls).padStart(6)} llamadas  ${usd(line.costUsd)}`,
      ),
  ];
  return [
    `Costo de IA de ${report.month} (UTC)`,
    "",
    `Total:                    ${usd(report.costUsd)} en ${report.calls} llamadas`,
    `Usuarios activos:         ${report.activeUsers} (con al menos una comida en el mes)`,
    `Promedio por usuario:     ${report.costPerActiveUserUsd === null ? "—" : usd(report.costPerActiveUserUsd)}`,
    `Análisis desde la cache:  ${report.cachedAnalyses} (sin llamar a la IA)`,
    ...(report.unpricedCalls > 0
      ? [
          `⚠ ${report.unpricedCalls} llamadas de modelos sin precio en config/ai-pricing.ts no suman al total`,
        ]
      : []),
    "",
    ...table("Por tipo de llamada", report.byKind as Record<string, CostLine>),
    "",
    ...table("Por modelo", report.byModel),
  ].join("\n");
}
