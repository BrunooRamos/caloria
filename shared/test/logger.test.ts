import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithRequestContext, serializeError } from "../src";
import { captureLogger } from "./helpers";

describe("logger", () => {
  it("escribe JSON con servicio, nivel y el requestId del child", () => {
    const { logger, lines } = captureLogger("back");
    logger.child({ requestId: "abc" }).info("hola", { status: 200 });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].service, "back");
    assert.equal(lines[0].level, "info");
    assert.equal(lines[0].requestId, "abc");
    assert.equal(lines[0].msg, "hola");
    assert.equal(lines[0].status, 200);
  });

  it("toma el requestId de la request en curso sin pasarle req", async () => {
    const { logger, lines } = captureLogger();
    await runWithRequestContext({ requestId: "ctx-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info("desde un service");
    });
    assert.equal(lines[0].requestId, "ctx-1");
  });

  it("no filtra PII: redacta claves sensibles, emails, Bearer y JWT", () => {
    const { logger, lines } = captureLogger();
    logger.info("login de cami@example.com", {
      password: "hunter2",
      authorization: "Bearer abc.def",
      user: { email: "cami@example.com", refreshToken: "r" },
      body: { anything: 1 },
      detail: 'dup key { email: "cami@example.com" } token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl',
    });
    const raw = JSON.stringify(lines[0]);
    for (const secret of ["cami@example.com", "hunter2", "Bearer", "eyJhbGciOi", "anything"]) {
      assert.ok(!raw.includes(secret), `el log contiene ${secret}: ${raw}`);
    }
  });

  it("serializa errores con stack solo si se pide", () => {
    const err = new Error("falló", { cause: new Error("causa") });
    assert.equal(serializeError(err).stack, undefined);
    const full = serializeError(err, { stack: true });
    assert.match(String(full.stack), /falló/);
    assert.equal((full.cause as { message: string }).message, "causa");
  });
});
