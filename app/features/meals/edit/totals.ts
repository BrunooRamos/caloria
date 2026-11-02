import type { Range } from "@/services/meals";

export const sameRange = (a: Range, b: Range) => a.min === b.min && a.max === b.max;

/** Suma de los mínimos y suma de los máximos. */
export function sumRanges(ranges: readonly Range[]): Range {
  return ranges.reduce((total, { min, max }) => ({ min: total.min + min, max: total.max + max }), {
    min: 0,
    max: 0,
  });
}

/** De dónde sale el total: el que había, la suma de los ingredientes o el que escribió la persona. */
export type TotalSource = "current" | "sum" | "manual";

export interface TotalKcal {
  kcal: Range;
  source: TotalSource;
}

/**
 * Total de kcal de una corrección. Los macros no se derivan: cada ingrediente solo tiene
 * gramos y kcal.
 * - `manual`: la persona escribió el total. Se respeta aunque después cambien los ingredientes.
 * - `sum`: cambiaron las kcal de los ingredientes (se agregó, se quitó o se editó uno): es la suma
 *   de sus mínimos y de sus máximos.
 * - `current`: no cambiaron, o no queda ninguno con kcal: el total que había. No se recalcula,
 *   porque la IA puede contar cosas que no listó (el aceite, una salsa).
 *
 * `itemsKcal` son las kcal de los ingredientes que quedan, en orden; `undefined` en uno que todavía
 * no tiene kcal válidas, que no cuenta. Cambiar el nombre o los gramos no toca el total.
 */
export function totalKcal(
  current: { kcal: Range; items: readonly { kcal: Range }[] },
  itemsKcal: readonly (Range | undefined)[],
  manual?: Range,
): TotalKcal {
  if (manual) return { kcal: manual, source: "manual" };
  const known = itemsKcal.filter((kcal): kcal is Range => kcal !== undefined);
  const unchanged =
    known.length === current.items.length &&
    known.every((kcal, index) => sameRange(kcal, current.items[index].kcal));
  if (unchanged || known.length === 0) return { kcal: current.kcal, source: "current" };
  return { kcal: sumRanges(known), source: "sum" };
}
