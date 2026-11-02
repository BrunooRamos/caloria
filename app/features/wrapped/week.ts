import { shiftDay } from "@/features/history/day";

const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const pad = (n: number, size = 2) => String(n).padStart(size, "0");
const toUtc = (day: string) => new Date(`${day}T00:00:00Z`);
const fromUtc = (date: Date) =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const isoWeekday = (date: Date) => (date.getUTCDay() + 6) % 7;

export function isoWeeksInYear(year: number): number {
  const isThursday = (day: string) => isoWeekday(toUtc(day)) === 3;
  return isThursday(`${pad(year, 4)}-01-01`) || isThursday(`${pad(year, 4)}-12-31`) ? 53 : 52;
}

export function isValidWeek(value: string): boolean {
  const match = WEEK_PATTERN.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= isoWeeksInYear(Number(match[1]));
}

export function isoWeekOf(day: string): string {
  const date = toUtc(day);
  const thursday = new Date(date.getTime() + (3 - isoWeekday(date)) * MS_PER_DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = toUtc(`${pad(year, 4)}-01-01`);
  const week = 1 + Math.floor((thursday.getTime() - jan1.getTime()) / (7 * MS_PER_DAY));
  return `${pad(year, 4)}-W${pad(week)}`;
}

export function lastCompleteWeek(today: string): string {
  return isoWeekOf(shiftDay(today, -7));
}

export function resolveWeek(requested: string | undefined, today: string): string {
  const fallback = lastCompleteWeek(today);
  if (!requested || !isValidWeek(requested)) return fallback;
  return requested > fallback ? fallback : requested;
}

export function isoWeekRange(week: string): { from: string; to: string } {
  if (!isValidWeek(week)) throw new Error(`Semana inválida: ${week}`);
  const [year, number] = week.split("-W").map(Number);
  const jan4 = toUtc(`${pad(year, 4)}-01-04`);
  const monday = new Date(jan4.getTime() + ((number - 1) * 7 - isoWeekday(jan4)) * MS_PER_DAY);
  return { from: fromUtc(monday), to: shiftDay(fromUtc(monday), 6) };
}

export function weekLabel(week: string): string {
  const { from, to } = isoWeekRange(week);
  const [start, end] = [toUtc(from), toUtc(to)];
  const day = (date: Date) => date.getUTCDate();
  const month = (date: Date) => MONTHS[date.getUTCMonth()];
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    const full = (date: Date) => `${day(date)} de ${month(date)} de ${date.getUTCFullYear()}`;
    return `${full(start)}–${full(end)}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${day(start)} de ${month(start)}–${day(end)} de ${month(end)}`;
  }
  return `${day(start)}–${day(end)} de ${month(end)}`;
}
