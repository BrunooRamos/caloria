import { ApiError } from "../api-error";
import type { ApiErrorCode } from "../api-error";
import { GENERIC_ERROR_MESSAGE, errorMessage } from "../error-messages";

function apiError(code: ApiErrorCode, extra: { status?: number; retryAfterSeconds?: number } = {}) {
  return new ApiError({
    status: extra.status ?? 400,
    code,
    message: `mensaje técnico de ${code}`,
    requestId: "req-1",
    retryAfterSeconds: extra.retryAfterSeconds ?? null,
  });
}

describe("errorMessage", () => {
  it.each<[ApiErrorCode, string]>([
    ["VALIDATION_ERROR", "Revisá los datos e intentá de nuevo."],
    ["UNAUTHORIZED", "Tu sesión terminó. Ingresá de nuevo."],
    ["TOKEN_EXPIRED", "Tu sesión terminó. Ingresá de nuevo."],
    ["MEAL_QUOTA_EXCEEDED", "Ya usaste todos los análisis de este mes."],
    ["PREMIUM_REQUIRED", "Esto es parte del plan premium."],
    ["NOT_FOUND", "No encontramos lo que buscabas."],
    ["EMAIL_TAKEN", "Ya hay una cuenta con este email."],
    ["PAYLOAD_TOO_LARGE", "El archivo es demasiado pesado."],
    ["INTERNAL_ERROR", "Algo falló de nuestro lado. Probá de nuevo en un rato."],
    ["AI_UNAVAILABLE", "El análisis no está disponible ahora. Probá de nuevo en un rato."],
    [
      "SERVICE_UNAVAILABLE",
      "El servicio no está disponible ahora. Probá de nuevo en unos minutos.",
    ],
    ["NETWORK_ERROR", "No hay conexión. Revisá tu internet y probá de nuevo."],
    ["UNKNOWN_ERROR", GENERIC_ERROR_MESSAGE],
  ])("%s → %s", (code, expected) => {
    expect(errorMessage(apiError(code))).toBe(expected);
  });

  it("nunca muestra el message técnico del servidor", () => {
    expect(errorMessage(apiError("INTERNAL_ERROR"))).not.toContain("mensaje técnico");
  });

  describe("RATE_LIMITED", () => {
    it.each<[number, string]>([
      [1, "Probá de nuevo en 1 segundo."],
      [30, "Probá de nuevo en 30 segundos."],
      [60, "Probá de nuevo en 1 minuto."],
      [61, "Probá de nuevo en 2 minutos."],
      [3600, "Probá de nuevo en 1 hora."],
      [7201, "Probá de nuevo en 3 horas."],
      [0, "Ya podés probar de nuevo."],
    ])("con Retry-After de %i segundos lo dice: %s", (seconds, hint) => {
      expect(errorMessage(apiError("RATE_LIMITED", { retryAfterSeconds: seconds }))).toBe(
        `Hiciste muchos intentos seguidos. ${hint}`,
      );
    });

    it("sin Retry-After pide esperar un momento", () => {
      expect(errorMessage(apiError("RATE_LIMITED"))).toBe(
        "Hiciste muchos intentos seguidos. Esperá un momento y probá de nuevo.",
      );
    });
  });

  it("una pantalla puede reemplazar el mensaje de un código y deja el resto igual", () => {
    const overrides = { UNAUTHORIZED: "El email o la contraseña no son correctos." };

    expect(errorMessage(apiError("UNAUTHORIZED"), overrides)).toBe(
      "El email o la contraseña no son correctos.",
    );
    expect(errorMessage(apiError("NETWORK_ERROR"), overrides)).toBe(
      "No hay conexión. Revisá tu internet y probá de nuevo.",
    );
  });

  it("un override también puede armar el mensaje con el error", () => {
    const overrides = { RATE_LIMITED: (error: ApiError) => `Esperá ${error.retryAfterSeconds}` };

    expect(errorMessage(apiError("RATE_LIMITED", { retryAfterSeconds: 9 }), overrides)).toBe(
      "Esperá 9",
    );
  });

  it("cualquier cosa que no sea un ApiError da el mensaje genérico", () => {
    expect(errorMessage(new TypeError("undefined is not a function"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(errorMessage("boom")).toBe(GENERIC_ERROR_MESSAGE);
    expect(errorMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("un código que la app no conoce da el mensaje genérico", () => {
    const unknown = new ApiError({
      status: 418,
      code: "TEAPOT" as ApiErrorCode,
      message: "I'm a teapot",
      requestId: null,
    });

    expect(errorMessage(unknown)).toBe(GENERIC_ERROR_MESSAGE);
  });
});
