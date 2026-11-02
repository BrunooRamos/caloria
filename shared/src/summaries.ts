import { z } from "zod";

// RF-12. Semanas ISO 8601: de lunes a domingo; la semana 1 es la que tiene el primer jueves del año.
const ISO_WEEK = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Insights que pide el prompt del Wrapped y tope de cada uno: entra en una tarjeta. */
export const WRAPPED_INSIGHTS_MIN = 3;
export const WRAPPED_INSIGHTS_MAX = 5;
export const WRAPPED_INSIGHT_MAX_CHARS = 140;

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
/** Lunes = 0 … domingo = 6. */
const isoWeekday = (date: Date) => (date.getUTCDay() + 6) % 7;
const yearStr = (year: number) => String(year).padStart(4, "0");

/** 53 si el año empieza o termina en jueves; si no, 52. */
export function isoWeeksInYear(year: number): number {
  const thursday = (day: string) => isoWeekday(toDate(day)) === 3;
  return thursday(`${yearStr(year)}-01-01`) || thursday(`${yearStr(year)}-12-31`) ? 53 : 52;
}

/** `"2026-W43"` → `{ year: 2026, week: 43 }`, o undefined si el formato no es ese o la semana no existe. */
export function parseIsoWeek(value: string): { year: number; week: number } | undefined {
  const match = ISO_WEEK.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= isoWeeksInYear(year) ? { year, week } : undefined;
}

/** Semana ISO de un día `YYYY-MM-DD`: la del año de su jueves. */
export function isoWeekOf(day: string): string {
  const date = toDate(day);
  const thursday = addDays(date, 3 - isoWeekday(date));
  const year = thursday.getUTCFullYear();
  const week =
    1 +
    Math.floor((thursday.getTime() - toDate(`${yearStr(year)}-01-01`).getTime()) / (7 * DAY_MS));
  return `${yearStr(year)}-W${String(week).padStart(2, "0")}`;
}

/** La semana anterior a la del día dado: la que procesa el cron del lunes. */
export function previousIsoWeek(day: string): string {
  return isoWeekOf(toDay(addDays(toDate(day), -7)));
}

/** Lunes y domingo (`YYYY-MM-DD`) de la semana. Lanza si la semana no es válida. */
export function isoWeekRange(value: string): { from: string; to: string } {
  const parsed = parseIsoWeek(value);
  if (!parsed) throw new Error(`Semana ISO inválida: ${value}`);
  // El lunes de la semana 1 es el de la semana del 4 de enero.
  const jan4 = toDate(`${yearStr(parsed.year)}-01-04`);
  const monday = addDays(jan4, (parsed.week - 1) * 7 - isoWeekday(jan4));
  return { from: toDay(monday), to: toDay(addDays(monday, 6)) };
}

export const isoWeekSchema = z
  .string()
  .regex(ISO_WEEK)
  .refine((value) => parseIsoWeek(value) !== undefined, { message: "La semana no existe" });

/** `:week` de `GET /summaries/weekly/:week`: `YYYY-Www` y una semana que exista en ese año. */
export const weeklySummaryParamsSchema = z.object({ week: isoWeekSchema }).strict();

export interface WeeklyMetrics {
  avgKcal: number;
  daysLogged: number;
  streak: number;
  topDish: string;
}

/** `GET /summaries/weekly/:week`. `from` y `to` son el lunes y el domingo de la semana. */
export interface WeeklySummaryResponse {
  week: string;
  from: string;
  to: string;
  metrics: WeeklyMetrics;
  insights: string[];
  generatedAt: string;
}
