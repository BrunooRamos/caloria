import { formatNumber } from "@/features/dashboard/format";
import { dayMonthLabel, shiftMonths, todayIn } from "@/features/history/day";
import type { Price } from "@/services/billing";

/**
 * Símbolos sin ambigüedad: "$" solo no dice si son pesos uruguayos, argentinos o dólares. Una
 * moneda que no está acá se escribe con su código ("BRL 25").
 */
const SYMBOLS: Record<string, string> = { USD: "US$", UYU: "$U", ARS: "AR$", EUR: "€" };

const INTERVALS = {
  month: { per: "por mes", every: "cada mes", months: 1 },
  year: { per: "por año", every: "cada año", months: 12 },
} as const satisfies Record<Price["interval"], { per: string; every: string; months: number }>;

/** "US$ 4,99", "US$ 5", "$U 1.290". El monto viene en centavos. */
export function formatPrice({ amount, currency }: Pick<Price, "amount" | "currency">): string {
  const whole = Math.trunc(amount / 100);
  const cents = amount % 100;
  const number =
    cents === 0 ? formatNumber(whole) : `${formatNumber(whole)},${String(cents).padStart(2, "0")}`;
  return `${SYMBOLS[currency] ?? currency} ${number}`;
}

/** "US$ 4,99 por mes". */
export function formatPricePerInterval(price: Price): string {
  return `${formatPrice(price)} ${INTERVALS[price.interval].per}`;
}

/** "cada mes", "cada año". */
export function everyInterval(interval: Price["interval"]): string {
  return INTERVALS[interval].every;
}

/** Qué día cae `iso` (un instante, como `periodEnd`) en `timeZone`: `2026-12-04`. */
export function dayIn(iso: string, timeZone: string): string {
  return todayIn(timeZone, new Date(iso));
}

/** "4 de diciembre" para un instante, en el día que le toca en `timeZone`. */
export function formatInstantDay(iso: string, timeZone: string, now: Date): string {
  return dayMonthLabel(dayIn(iso, timeZone), todayIn(timeZone, now));
}

/** "1 de diciembre" para un día `YYYY-MM-DD` que ya está en la zona del usuario, como `resetsOn`. */
export function formatDay(day: string, timeZone: string, now: Date): string {
  return dayMonthLabel(day, todayIn(timeZone, now));
}

/** El primer cobro es hoy: el siguiente, un período después (en el día de la zona del usuario). */
export function nextChargeDay(interval: Price["interval"], timeZone: string, now: Date): string {
  const today = todayIn(timeZone, now);
  return dayMonthLabel(shiftMonths(today, INTERVALS[interval].months), today);
}
