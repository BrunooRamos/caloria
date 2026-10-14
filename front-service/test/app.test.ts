import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express, { Router } from "express";
import { AppError, errorHandler, notFoundHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
import { captureLogger, listen, UUID } from "./helpers";

type Envelope = { error: { code: string; message: string; requestId: string } };

/** Backend de prueba armado con los mismos middlewares que back-service. */
function fakeBackend() {
  const { logger, lines } = captureLogger("back");
  const received: (string | undefined)[] = [];
  const app = express();
  app.use((req, _res, next) => {
    received.push(req.get("x-request-id"));
    next();
  });
  app.use(requestContext({ logger, trustIncomingId: true }));
  app.get("/api/v1/ok", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/v1/quota", () => {
    throw new AppError("MEAL_QUOTA_EXCEEDED");
  });
  app.get("/api/v1/html", (_req, res) => {
    res.status(502).type("html").send("<html>Bad Gateway</html>");
  });
  app.get("/api/v1/sobre-invalido", (_req, res) => {
    res.status(400).json({ error: "algo salió mal" });
  });
  app.get("/api/v1/no-json", (_req, res) => {
    res.type("text").send("ok");
  });
  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return { app, lines, received };
}

/** Front con una ruta que reenvía cualquier GET de /api/v1 al Backend. */
function front(backendUrl: string) {
  const { logger, lines } = captureLogger("front");
  const backend = createBackendClient({ baseUrl: backendUrl, timeoutMs: 2000 });
  const api = Router();
  api.get("/boom", () => {
    throw new Error("token=eyJabc.eyJdef.sig mongodb://admin:s3cr3t@db");
  });
  api.get("/{*path}", async (req, res) => {
    const { status, body } = await backend.request({
      method: "GET",
      path: req.originalUrl,
      requestId: req.requestId,
      headers: { "x-request-id": "intento-de-pisar" },
    });
    res.status(status).json(body);
  });
  return { app: createApp({ logger, api }), lines };
}

function assertNoLeak(raw: string) {
  for (const leak of ["    at ", ".ts:", "s3cr3t", "eyJabc", "ECONNREFUSED", "<html>"]) {
    assert.ok(!raw.includes(leak), `la respuesta filtra "${leak}": ${raw}`);
  }
}

describe("front-service", () => {
  const back = fakeBackend();
  let backUrl: string;
  let frontUrl: string;
  let deadUrl: string;
  let closeBack: () => Promise<void>;
  let closeFront: () => Promise<void>;
  let frontLines: Record<string, unknown>[];

  before(async () => {
    ({ url: backUrl, close: closeBack } = await listen(back.app));
    const f = front(backUrl);
    frontLines = f.lines;
    ({ url: frontUrl, close: closeFront } = await listen(f.app));

    const dead = await listen(express());
    deadUrl = dead.url;
    await dead.close();
  });
  after(async () => {
    await closeFront();
    await closeBack();
  });

  const clientId = "22222222-2222-4222-8222-222222222222";

  it("ignora el X-Request-Id del cliente y devuelve uno nuevo en el header", async () => {
    const res = await fetch(`${frontUrl}/health`, { headers: { "x-request-id": clientId } });
    const requestId = res.headers.get("x-request-id");
    assert.match(String(requestId), UUID);
    assert.notEqual(requestId, clientId);
  });

  it("propaga el mismo requestId al Backend y aparece en los logs de ambos", async () => {
    const res = await fetch(`${frontUrl}/api/v1/ok`, { headers: { "x-request-id": clientId } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const requestId = res.headers.get("x-request-id");
    assert.match(String(requestId), UUID);
    assert.notEqual(requestId, clientId);
    assert.equal(back.received.at(-1), requestId);
    assert.ok(back.lines.some((l) => l.service === "back" && l.requestId === requestId));
    assert.ok(frontLines.some((l) => l.service === "front" && l.requestId === requestId));
    assert.ok(!back.lines.some((l) => l.level === "warn" && l.requestId === requestId));
  });

  it("los errores del Backend con sobre válido pasan sin modificar", async () => {
    const res = await fetch(`${frontUrl}/api/v1/quota`);
    const requestId = res.headers.get("x-request-id");
    assert.equal(res.status, 402);
    assert.deepEqual(await res.json(), {
      error: { code: "MEAL_QUOTA_EXCEEDED", message: "Cupo mensual agotado", requestId },
    });
  });

  it("un 404 del Backend también pasa intacto", async () => {
    const res = await fetch(`${frontUrl}/api/v1/meals/66f1a`);
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(body.error.requestId, res.headers.get("x-request-id"));
  });

  for (const [path, status] of [
    ["/api/v1/html", 502],
    ["/api/v1/sobre-invalido", 400],
    ["/api/v1/no-json", 200],
  ] as const) {
    it(`Backend con respuesta inválida (${path}, ${status}) → 500 propio del Front`, async () => {
      const res = await fetch(`${frontUrl}${path}`);
      const raw = await res.text();
      assert.equal(res.status, 500);
      assert.deepEqual(JSON.parse(raw), {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno",
          requestId: res.headers.get("x-request-id"),
        },
      });
      assertNoLeak(raw);
    });
  }

  it("Backend caído → 503 SERVICE_UNAVAILABLE con el sobre del Front", async () => {
    const { logger, lines } = captureLogger("front");
    const backend = createBackendClient({ baseUrl: deadUrl, timeoutMs: 2000 });
    const api = Router();
    api.get("/ok", async (req, res) => {
      const { body } = await backend.request({
        method: "GET",
        path: "/api/v1/ok",
        requestId: req.requestId,
      });
      res.json(body);
    });
    const app = await listen(createApp({ logger, api }));
    try {
      const res = await fetch(`${app.url}/api/v1/ok`);
      const raw = await res.text();
      const requestId = res.headers.get("x-request-id");
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(raw), {
        error: { code: "SERVICE_UNAVAILABLE", message: "Servicio no disponible", requestId },
      });
      assertNoLeak(raw);
      const log = lines.find((l) => l.level === "error" && l.requestId === requestId);
      assert.ok(log, "falta el log del 503");
      assert.match(JSON.stringify(log.err), /ECONNREFUSED|fetch failed/);
    } finally {
      await app.close();
    }
  });

  it("error inesperado en el Front → 500 genérico sin mensaje ni stack", async () => {
    const res = await fetch(`${frontUrl}/api/v1/boom`);
    const raw = await res.text();
    assert.equal(res.status, 500);
    assert.equal((JSON.parse(raw) as Envelope).error.message, "Error interno");
    assertNoLeak(raw);
    // El log tiene el stack pero no el token.
    const requestId = res.headers.get("x-request-id");
    const log = frontLines.find((l) => l.level === "error" && l.requestId === requestId);
    assert.ok(log);
    assert.match(JSON.stringify(log.err), /s3cr3t/);
    assert.ok(!JSON.stringify(log).includes("eyJabc"));
  });

  it("JSON malformado → 400 con el sobre del Front, sin llegar al Backend", async () => {
    const before = back.received.length;
    const res = await fetch(`${frontUrl}/api/v1/ok`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, 400);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal(body.error.requestId, res.headers.get("x-request-id"));
    assert.equal(back.received.length, before);
  });
});
