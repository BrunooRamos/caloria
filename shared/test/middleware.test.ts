import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { AppError, errorHandler, notFoundHandler, requestContext } from "../src";
import { captureLogger, flush, listen, UUID } from "./helpers";

const SECRET = "mongodb://admin:s3cr3t@db/caloria";

function buildApp(trustIncomingId: boolean) {
  const { logger, lines } = captureLogger();
  const app = express();
  app.use(requestContext({ logger, trustIncomingId }));
  app.use(express.json({ limit: "1kb" }));

  app.get("/ok", (req, res) => {
    res.json({ requestId: req.requestId });
  });
  app.get("/quota", () => {
    throw new AppError("MEAL_QUOTA_EXCEEDED");
  });
  app.post("/zod", (req, res) => {
    res.json(z.object({ grams: z.number() }).parse(req.body));
  });
  const upload = multer({ limits: { fileSize: 10, fieldSize: 10 } });
  app.post("/upload", upload.single("photo"), (_req, res) => {
    res.status(201).end();
  });
  app.get("/boom", () => {
    throw new Error(`no conecta a ${SECRET}`);
  });
  app.get("/boom-async", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    throw new TypeError(`fallo async ${SECRET}`);
  });

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return { app, lines };
}

type Envelope = { error: { code: string; message: string; requestId: string } };

async function expectEnvelope(res: Response, status: number, code: string): Promise<Envelope> {
  assert.equal(res.status, status);
  const body = (await res.json()) as Envelope;
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message", "requestId"]);
  assert.equal(body.error.code, code);
  assert.match(body.error.requestId, UUID);
  assert.equal(body.error.requestId, res.headers.get("x-request-id"));
  return body;
}

describe("errorHandler", () => {
  const { app, lines } = buildApp(false);
  let url: string;
  let close: () => Promise<void>;
  before(async () => ({ url, close } = await listen(app)));
  after(() => close());

  it("AppError → status derivado del code y su mensaje", async () => {
    const body = await expectEnvelope(await fetch(`${url}/quota`), 402, "MEAL_QUOTA_EXCEEDED");
    assert.equal(body.error.message, "Cupo mensual agotado");
  });

  it("ZodError → 400 VALIDATION_ERROR", async () => {
    const res = await fetch(`${url}/zod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grams: "mucho" }),
    });
    await expectEnvelope(res, 400, "VALIDATION_ERROR");
  });

  it("JSON malformado → 400 VALIDATION_ERROR", async () => {
    const res = await fetch(`${url}/zod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"grams": ',
    });
    await expectEnvelope(res, 400, "VALIDATION_ERROR");
  });

  it("body por encima del límite → 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await fetch(`${url}/zod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "x".repeat(5000) }),
    });
    await expectEnvelope(res, 413, "PAYLOAD_TOO_LARGE");
  });

  it("archivo por encima del límite de multer → 413 PAYLOAD_TOO_LARGE", async () => {
    const form = new FormData();
    form.append("photo", new Blob([Buffer.alloc(100)], { type: "image/jpeg" }), "plato.jpg");
    await expectEnvelope(
      await fetch(`${url}/upload`, { method: "POST", body: form }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("campo de texto por encima del límite de multer → 400 VALIDATION_ERROR", async () => {
    const form = new FormData();
    form.append("note", "x".repeat(11));
    await expectEnvelope(
      await fetch(`${url}/upload`, { method: "POST", body: form }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("ruta inexistente → 404 NOT_FOUND", async () => {
    await expectEnvelope(await fetch(`${url}/no-existe`), 404, "NOT_FOUND");
  });

  for (const path of ["/boom", "/boom-async"]) {
    it(`error inesperado (${path}) → 500 genérico, sin mensaje ni stack`, async () => {
      const res = await fetch(`${url}${path}`);
      const raw = await res.clone().text();
      const body = await expectEnvelope(res, 500, "INTERNAL_ERROR");
      assert.equal(body.error.message, "Error interno");
      for (const leak of ["s3cr3t", "mongodb", "fallo async", "Error:", "    at ", ".ts:"]) {
        assert.ok(!raw.includes(leak), `la respuesta filtra "${leak}": ${raw}`);
      }

      // El detalle sí queda en el log, con stack y el mismo requestId.
      const log = lines.find((l) => l.level === "error" && l.requestId === body.error.requestId);
      assert.ok(log, "falta el log del 500");
      const err = log.err as { message: string; stack: string };
      assert.match(err.message, /s3cr3t|fallo async/);
      assert.match(err.stack, /\n\s+at /);
    });
  }

  it("los 4xx se loguean sin stack", async () => {
    const res = await fetch(`${url}/zod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const { error } = (await res.json()) as Envelope;
    const log = lines.find((l) => l.level === "warn" && l.requestId === error.requestId);
    assert.ok(log);
    assert.equal(log.code, "VALIDATION_ERROR");
    assert.deepEqual(log.issues, [{ path: ["grams"], code: "invalid_type" }]);
    assert.ok(!JSON.stringify(log).includes("stack"));
  });
});

describe("requestContext", () => {
  const front = buildApp(false);
  const back = buildApp(true);
  let frontUrl: string;
  let backUrl: string;
  let closeFront: () => Promise<void>;
  let closeBack: () => Promise<void>;
  before(async () => {
    ({ url: frontUrl, close: closeFront } = await listen(front.app));
    ({ url: backUrl, close: closeBack } = await listen(back.app));
  });
  after(async () => {
    await closeFront();
    await closeBack();
  });

  const clientId = "11111111-1111-4111-8111-111111111111";

  it("Front: ignora el X-Request-Id del cliente, genera un UUID y lo devuelve", async () => {
    const res = await fetch(`${frontUrl}/ok`, { headers: { "x-request-id": clientId } });
    const { requestId } = (await res.json()) as { requestId: string };
    assert.match(requestId, UUID);
    assert.notEqual(requestId, clientId);
    assert.equal(res.headers.get("x-request-id"), requestId);
  });

  it("Backend: usa el X-Request-Id recibido", async () => {
    const res = await fetch(`${backUrl}/ok`, { headers: { "x-request-id": clientId } });
    assert.deepEqual(await res.json(), { requestId: clientId });
    assert.equal(res.headers.get("x-request-id"), clientId);
  });

  for (const [caso, headers, reason] of [
    ["falta", {}, "missing"],
    ["es inválido", { "x-request-id": "no-es-un-uuid" }, "invalid"],
  ] as const) {
    it(`Backend: si el X-Request-Id ${caso}, genera uno y loguea un warning`, async () => {
      const res = await fetch(`${backUrl}/ok`, { headers });
      const { requestId } = (await res.json()) as { requestId: string };
      assert.match(requestId, UUID);
      const warn = back.lines.find((l) => l.level === "warn" && l.requestId === requestId);
      assert.equal(warn?.reason, reason);
      assert.ok(!JSON.stringify(warn).includes("no-es-un-uuid"));
    });
  }

  it("loguea cada request con requestId, sin query string ni headers", async () => {
    const res = await fetch(`${frontUrl}/ok?email=cami@example.com`, {
      headers: { authorization: "Bearer secreto" },
    });
    const { requestId } = (await res.json()) as { requestId: string };
    await flush();
    const access = front.lines.find((l) => l.msg === "request" && l.requestId === requestId);
    assert.ok(access);
    assert.equal(access.path, "/ok");
    assert.equal(access.status, 200);
    const raw = JSON.stringify(front.lines);
    assert.ok(!raw.includes("cami@example.com"));
    assert.ok(!raw.includes("secreto"));
  });
});
