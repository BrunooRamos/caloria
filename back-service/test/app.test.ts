import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Router } from "express";
import { createApp } from "../src/app";
import { captureLogger, listen, UUID } from "./helpers";

describe("back-service: sobre de error y requestId", () => {
  const { logger, lines } = captureLogger("back");
  const api = Router();
  api.get("/boom", () => {
    throw new Error('E11000 duplicate key { email: "cami@example.com" }');
  });
  const app = createApp({ logger, api });
  let url: string;
  let close: () => Promise<void>;
  before(async () => ({ url, close } = await listen(app)));
  after(() => close());

  const frontId = "0b6f5a52-3c1e-4a8e-9f57-0e1d1f6a2c10";

  it("responde los 404 con el sobre y el requestId que mandó el Front", async () => {
    const res = await fetch(`${url}/api/v1/no-existe`, { headers: { "x-request-id": frontId } });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("x-request-id"), frontId);
    assert.deepEqual(await res.json(), {
      error: { code: "NOT_FOUND", message: "Ruta inexistente", requestId: frontId },
    });
  });

  it("los 500 no filtran el mensaje ni el stack, y el log no tiene PII", async () => {
    const res = await fetch(`${url}/api/v1/boom`, { headers: { "x-request-id": frontId } });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), {
      error: { code: "INTERNAL_ERROR", message: "Error interno", requestId: frontId },
    });
    const log = lines.find((l) => l.level === "error" && l.requestId === frontId);
    assert.ok(log, "falta el log del 500 con el requestId");
    assert.match((log.err as { stack: string }).stack, /E11000/);
    assert.ok(!JSON.stringify(lines).includes("cami@example.com"));
  });

  it("sin X-Request-Id genera uno, lo devuelve y loguea un warning", async () => {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    const requestId = res.headers.get("x-request-id");
    assert.match(String(requestId), UUID);
    assert.ok(lines.some((l) => l.level === "warn" && l.requestId === requestId));
  });
});

describe("back-service: /health", () => {
  const { logger } = captureLogger("back");

  for (const [mongo, status] of [
    ["connected", 200],
    ["connecting", 503],
  ] as const) {
    it(`mongo ${mongo} → ${status}`, async () => {
      const { url, close } = await listen(createApp({ logger, mongoStatus: () => mongo }));
      const res = await fetch(`${url}/health`);
      await close();
      assert.equal(res.status, status);
      assert.equal(((await res.json()) as { mongo: string }).mongo, mongo);
    });
  }
});
