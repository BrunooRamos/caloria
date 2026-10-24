import { ApiError } from "./api-error";
import type { ApiErrorCode } from "./api-error";

export type ErrorMessage = string | ((error: ApiError) => string);

export type ErrorMessageOverrides = Partial<Record<ApiErrorCode, ErrorMessage>>;

export const GENERIC_ERROR_MESSAGE = "Algo salió mal. Probá de nuevo.";

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function retryHint(seconds: number | null): string {
  if (seconds === null) return "Esperá un momento y probá de nuevo.";
  if (seconds <= 0) return "Ya podés probar de nuevo.";
  if (seconds < 60) return `Probá de nuevo en ${plural(seconds, "segundo", "segundos")}.`;
  if (seconds < 3600) {
    return `Probá de nuevo en ${plural(Math.ceil(seconds / 60), "minuto", "minutos")}.`;
  }
  return `Probá de nuevo en ${plural(Math.ceil(seconds / 3600), "hora", "horas")}.`;
}

const MESSAGES: Record<ApiErrorCode, ErrorMessage> = {
  VALIDATION_ERROR: "Revisá los datos e intentá de nuevo.",
  UNAUTHORIZED: "Tu sesión terminó. Ingresá de nuevo.",
  TOKEN_EXPIRED: "Tu sesión terminó. Ingresá de nuevo.",
  MEAL_QUOTA_EXCEEDED: "Ya usaste todos los análisis de este mes.",
  PREMIUM_REQUIRED: "Esto es parte del plan premium.",
  NOT_FOUND: "No encontramos lo que buscabas.",
  EMAIL_TAKEN: "Ya hay una cuenta con este email.",
  PAYLOAD_TOO_LARGE: "El archivo es demasiado pesado.",
  RATE_LIMITED: ({ retryAfterSeconds }) =>
    `Hiciste muchos intentos seguidos. ${retryHint(retryAfterSeconds)}`,
  INTERNAL_ERROR: "Algo falló de nuestro lado. Probá de nuevo en un rato.",
  AI_UNAVAILABLE: "El análisis no está disponible ahora. Probá de nuevo en un rato.",
  SERVICE_UNAVAILABLE: "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
  NETWORK_ERROR: "No hay conexión. Revisá tu internet y probá de nuevo.",
  UNKNOWN_ERROR: GENERIC_ERROR_MESSAGE,
};

export function errorMessage(error: unknown, overrides: ErrorMessageOverrides = {}): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR_MESSAGE;
  const message = overrides[error.code] ?? MESSAGES[error.code] ?? GENERIC_ERROR_MESSAGE;
  return typeof message === "function" ? message(error) : message;
}
