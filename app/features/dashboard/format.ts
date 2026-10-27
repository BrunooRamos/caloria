import type { DailyRange } from "@/services/dashboard";

export function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return rounded < 0 ? `-${digits}` : digits;
}

/** `1.450–1.820`, o un solo número si los extremos coinciden. La unidad la pone quien lo usa. */
export function formatDailyRange({ min, max }: Pick<DailyRange, "min" | "max">): string {
  const low = formatNumber(min);
  const high = formatNumber(max);
  return low === high ? low : `${low}–${high}`;
}

/** Cuánto se llena la barra: el punto medio contra la meta, entre 0 y 1. Pasarse la deja llena. */
export function progressOf(mid: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(Math.max(mid / target, 0), 1);
}

/** `1 comida`, `2 comidas`. */
export function mealsCount(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "comida" : "comidas"}`;
}
