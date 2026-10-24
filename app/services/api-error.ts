/** Códigos del sobre de error de la API (ver docs/api.md, "Códigos de error"). */
const SERVER_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "MEAL_QUOTA_EXCEEDED",
  "PREMIUM_REQUIRED",
  "NOT_FOUND",
  "EMAIL_TAKEN",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "AI_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

/**
 * Códigos que arma el cliente cuando no hay sobre:
 * - `NETWORK_ERROR`: `fetch` falló (sin conexión, DNS, servidor caído). `status` es 0.
 * - `UNKNOWN_ERROR`: la respuesta no es un sobre válido (por ejemplo, un 502 HTML de nginx)
 *   o trae un código que esta versión de la app no conoce. Un 429 sin sobre queda como `RATE_LIMITED`.
 *
 * El texto que ve el usuario sale de `errorMessage` en error-messages.ts, nunca de `message`.
 */
export type ClientErrorCode = "NETWORK_ERROR" | "UNKNOWN_ERROR";

export type ApiErrorCode = ServerErrorCode | ClientErrorCode;

export interface ApiErrorInit {
  status: number;
  code: ApiErrorCode;
  message: string;
  requestId: string | null;
  retryAfterSeconds?: number | null;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Correlaciona con los logs del Front y del Backend. `null` si la request no llegó. */
  readonly requestId: string | null;
  /** Segundos del header `Retry-After` (en un 429), o `null` si no vino. */
  readonly retryAfterSeconds: number | null;

  constructor({ status, code, message, requestId, retryAfterSeconds = null, cause }: ApiErrorInit) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isServerErrorCode(value: unknown): value is ServerErrorCode {
  return SERVER_ERROR_CODES.some((code) => code === value);
}

export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Una fecha HTTP lleva el día y el mes en letras; sin esto, Date.parse acepta "-5" o "1.5".
  if (!/[a-z]/i.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export interface ResponseMeta {
  requestId: string | null;
  retryAfterSeconds: number | null;
}

/** Convierte una respuesta no-2xx en `ApiError`, use o no el sobre `{ error: { code, message, requestId } }`. */
export function apiErrorFromResponse(
  status: number,
  payload: unknown,
  { requestId: headerRequestId, retryAfterSeconds }: ResponseMeta,
): ApiError {
  const error =
    typeof payload === "object" && payload !== null
      ? (payload as { error?: unknown }).error
      : undefined;

  if (typeof error === "object" && error !== null) {
    const { code, message, requestId } = error as Record<string, unknown>;
    if (typeof message === "string") {
      return new ApiError({
        status,
        code: isServerErrorCode(code) ? code : "UNKNOWN_ERROR",
        message,
        requestId: typeof requestId === "string" ? requestId : headerRequestId,
        retryAfterSeconds,
      });
    }
  }

  if (status === 429) {
    return new ApiError({
      status,
      code: "RATE_LIMITED",
      message: "Demasiadas requests",
      requestId: headerRequestId,
      retryAfterSeconds,
    });
  }

  return new ApiError({
    status,
    code: "UNKNOWN_ERROR",
    message: "Respuesta inesperada del servidor",
    requestId: headerRequestId,
  });
}
