/*
 * Días del historial (RF-08). Un día es `YYYY-MM-DD` en la zona del usuario, el mismo formato que
 * `localDate` en el Backend y que `date` en `GET /meals`. Las cuentas se hacen en UTC para que un
 * cambio de horario no corra el día.
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
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

/** El día a las 00:00 UTC, o `null` si no es `YYYY-MM-DD` o no existe (`2026-02-30`). */
function toUtc(day: string): Date | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, date));
  const real =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
  return real ? utc : null;
}

function fromUtc(date: Date): string {
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isValidDay(day: string): boolean {
  return toUtc(day) !== null;
}

/** Las partes de `date` en `timeZone`; con una zona que el dispositivo no conoce, la local. */
function partsIn(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", options);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

/** Qué día es `now` en `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const { year, month, day } = partsIn(now, timeZone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

/** `day` corrido `delta` días (negativo: hacia atrás). */
export function shiftDay(day: string, delta: number): string {
  const utc = toUtc(day);
  if (!utc) throw new Error(`Día inválido: ${day}`);
  return fromUtc(new Date(utc.getTime() + delta * MS_PER_DAY));
}

export function previousDay(day: string): string {
  return shiftDay(day, -1);
}

/** El día siguiente, o `null` si sería después de hoy: el historial nunca va al futuro. */
export function nextDay(day: string, today: string): string | null {
  if (day >= today) return null;
  return shiftDay(day, 1);
}

/** El día que pide la ruta: si falta, es inválido o es futuro, hoy. */
export function resolveDay(requested: string | undefined, today: string): string {
  if (!requested || !isValidDay(requested) || requested > today) return today;
  return requested;
}

/** "lunes 20 de octubre"; con el año si no es el de `today`. */
export function longDayLabel(day: string, today: string): string {
  const utc = toUtc(day);
  if (!utc) return day;
  const label = `${WEEKDAYS[utc.getUTCDay()]} ${utc.getUTCDate()} de ${MONTHS[utc.getUTCMonth()]}`;
  return today.slice(0, 4) === day.slice(0, 4) ? label : `${label} de ${utc.getUTCFullYear()}`;
}

/** "Hoy", "Ayer", "lunes 20 de octubre"; con el año si no es el de hoy. */
export function dayTitle(day: string, today: string): string {
  if (day === today) return "Hoy";
  if (isValidDay(today) && day === previousDay(today)) return "Ayer";
  return longDayLabel(day, today);
}

/** La hora de `capturedAt` (ISO) en `timeZone`, en 24 h: `13:05`, `00:40`. */
export function formatTime(capturedAt: string, timeZone: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return "";
  const { hour, minute } = partsIn(date, timeZone, {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  // Algunos motores dan 24 para la medianoche aun con h23.
  return `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
