export const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: "La solicitud no es válida" },
  UNAUTHORIZED: { status: 401, message: "No autenticado" },
  TOKEN_EXPIRED: { status: 401, message: "La sesión expiró" },
  MEAL_QUOTA_EXCEEDED: { status: 402, message: "Cupo mensual agotado" },
  PREMIUM_REQUIRED: { status: 402, message: "Función exclusiva del plan premium" },
  NOT_FOUND: { status: 404, message: "Recurso inexistente" },
  EMAIL_TAKEN: { status: 409, message: "El email ya está registrado" },
  MEAL_NOT_READY: { status: 409, message: "La comida no tiene un análisis para corregir" },
  SUBSCRIPTION_ACTIVE: { status: 409, message: "Ya tenés una suscripción premium activa" },
  PAYLOAD_TOO_LARGE: { status: 413, message: "La solicitud supera el tamaño permitido" },
  RATE_LIMITED: { status: 429, message: "Demasiadas solicitudes" },
  DAILY_LIMIT_EXCEEDED: { status: 429, message: "Límite diario de análisis alcanzado" },
  INTERNAL_ERROR: { status: 500, message: "Error interno" },
  AI_UNAVAILABLE: { status: 503, message: "El análisis de IA no está disponible en este momento" },
  SERVICE_UNAVAILABLE: { status: 503, message: "Servicio no disponible" },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; requestId: string };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CATALOG, value);
}

export function statusForCode(code: ErrorCode): number {
  return ERROR_CATALOG[code].status;
}

export interface AppErrorOptions {
  cause?: unknown;
  /** Segundos hasta poder reintentar: el middleware de errores los manda en `Retry-After`. */
  retryAfterSeconds?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    super(message ?? ERROR_CATALOG[code].message, options);
    this.name = "AppError";
    this.code = code;
    this.status = statusForCode(code);
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = Math.max(0, Math.ceil(options.retryAfterSeconds));
    }
  }
}

export function errorEnvelope(error: AppError, requestId: string): ErrorEnvelope {
  return { error: { code: error.code, message: error.message, requestId } };
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const { code, message, requestId } = error as Record<string, unknown>;
  return isErrorCode(code) && typeof message === "string" && typeof requestId === "string";
}
