import { isBillingEnabled } from "@/features/billing/billingEnabled";
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
  MEAL_QUOTA_EXCEEDED:
    "Llegaste al límite de análisis de este mes. Se renueva el 1.º del mes que viene.",
  // Sin pagos (build de Google Play) no se nombra premium.
  PREMIUM_REQUIRED: () =>
    isBillingEnabled() ? "Esto es parte del plan premium." : "Esto no está incluido en tu plan.",
  NOT_FOUND: "No encontramos lo que buscabas.",
  EMAIL_TAKEN: "Ya hay una cuenta con este email.",
  MEAL_NOT_READY: "Esta comida todavía no se puede corregir: falta que termine el análisis.",
  // Solo lo devuelve el alta de la suscripción, que sin pagos no se llama.
  SUBSCRIPTION_ACTIVE: "Ya tenés una suscripción premium activa.",
  PAYLOAD_TOO_LARGE: "El archivo es demasiado pesado.",
  RATE_LIMITED: ({ retryAfterSeconds }) =>
    `Hiciste muchos intentos seguidos. ${retryHint(retryAfterSeconds)}`,
  DAILY_LIMIT_EXCEEDED: ({ retryAfterSeconds }) =>
    `Llegaste al máximo de fotos que se pueden analizar por día. ${retryHint(retryAfterSeconds)}`,
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

/** `error.code` de una comida en `failed` */
const MEAL_FAILURE_MESSAGES = {
  NOT_FOOD: "No encontramos comida en esta foto. Probá con otra en la que se vea el plato.",
  ENQUEUE_FAILED: "No pudimos analizar esta comida. Probá de nuevo en un rato.",
  ANALYSIS_FAILED: "No pudimos analizar esta comida. Probá de nuevo en un rato.",
} as const;

export const GENERIC_MEAL_FAILURE_MESSAGE =
  "No pudimos analizar esta comida. Probá de nuevo en un rato.";

/** Mensaje para una comida que terminó en `failed`; un código desconocido usa el genérico. */
export function mealFailureMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(MEAL_FAILURE_MESSAGES, code)
    ? MEAL_FAILURE_MESSAGES[code as keyof typeof MEAL_FAILURE_MESSAGES]
    : GENERIC_MEAL_FAILURE_MESSAGE;
}
