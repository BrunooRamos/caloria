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
 *   o trae un código que esta versión de la app no conoce.
 */
export type ClientErrorCode = "NETWORK_ERROR" | "UNKNOWN_ERROR";

export type ApiErrorCode = ServerErrorCode | ClientErrorCode;

export interface ApiErrorInit {
  status: number;
  code: ApiErrorCode;
  message: string;
  requestId: string | null;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** Correlaciona con los logs del Front y del Backend. `null` si la request no llegó. */
  readonly requestId: string | null;

  constructor({ status, code, message, requestId, cause }: ApiErrorInit) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function isServerErrorCode(value: unknown): value is ServerErrorCode {
  return SERVER_ERROR_CODES.some((code) => code === value);
}

/** Convierte una respuesta no-2xx en `ApiError`, use o no el sobre `{ error: { code, message, requestId } }`. */
export function apiErrorFromResponse(
  status: number,
  payload: unknown,
  headerRequestId: string | null,
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
      });
    }
  }

  return new ApiError({
    status,
    code: "UNKNOWN_ERROR",
    message: "Respuesta inesperada del servidor",
    requestId: headerRequestId,
  });
}

/** Mensaje para mostrarle al usuario a partir de cualquier error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Algo salió mal. Probá de nuevo.";
}
