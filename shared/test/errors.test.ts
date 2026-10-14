import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError, ERROR_CATALOG, errorEnvelope, isErrorEnvelope, statusForCode } from "../src";

describe("catálogo de errores", () => {
  it("deriva el status de cada code según docs/api.md", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, { status }]) => [code, status])),
      {
        VALIDATION_ERROR: 400,
        UNAUTHORIZED: 401,
        TOKEN_EXPIRED: 401,
        MEAL_QUOTA_EXCEEDED: 402,
        PREMIUM_REQUIRED: 402,
        NOT_FOUND: 404,
        EMAIL_TAKEN: 409,
        PAYLOAD_TOO_LARGE: 413,
        RATE_LIMITED: 429,
        INTERNAL_ERROR: 500,
        AI_UNAVAILABLE: 503,
        SERVICE_UNAVAILABLE: 503,
      },
    );
  });

  it("AppError toma status y mensaje por defecto del catálogo", () => {
    const err = new AppError("MEAL_QUOTA_EXCEEDED");
    assert.equal(err.status, 402);
    assert.equal(err.status, statusForCode("MEAL_QUOTA_EXCEEDED"));
    assert.equal(err.message, "Cupo mensual agotado");
    assert.equal(new AppError("NOT_FOUND", "Comida inexistente").message, "Comida inexistente");
  });

  it("arma el sobre único y lo reconoce", () => {
    const envelope = errorEnvelope(new AppError("EMAIL_TAKEN"), "req-1");
    assert.deepEqual(envelope, {
      error: { code: "EMAIL_TAKEN", message: "El email ya está registrado", requestId: "req-1" },
    });
    assert.equal(isErrorEnvelope(envelope), true);
    assert.equal(
      isErrorEnvelope({ error: { code: "INVENTADO", message: "x", requestId: "r" } }),
      false,
    );
    assert.equal(isErrorEnvelope({ error: "x" }), false);
    assert.equal(isErrorEnvelope("<html>"), false);
    assert.equal(isErrorEnvelope(null), false);
  });
});
