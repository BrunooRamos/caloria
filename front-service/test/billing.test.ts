import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import request from "supertest";
import { errorHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
import { apiRouter } from "../src/routes";
import { captureLogger, listen } from "./helpers";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });

interface Received {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/** Backend falso que guarda el body crudo, para ver que llega byte a byte. */
function rawBackend() {
  const { logger } = captureLogger("back");
  const received: Received[] = [];
  const app = express();
  app.use(requestContext({ logger, trustIncomingId: true }));
  app.post("/api/v1/billing/webhook", express.raw({ type: () => true }), (req, res) => {
    received.push({ body: req.body as Buffer, headers: req.headers });
    res.json({ received: true, duplicate: false });
  });
  app.use(errorHandler({ logger }));
  return { app, received };
}

describe("front-service: webhook de pagos", () => {
  const back = rawBackend();
  let close: () => Promise<void>;
  let front: ReturnType<typeof createApp>;

  before(async () => {
    const { url, close: closeBack } = await listen(back.app);
    close = closeBack;
    const { logger } = captureLogger("front");
    const client = createBackendClient({ baseUrl: url, timeoutMs: 2000 });
    front = createApp({ logger, api: apiRouter(client, keys.publicKey) });
  });
  after(async () => {
    await close();
  });
  beforeEach(() => {
    back.received.length = 0;
  });

  it("es pública y reenvía el body exacto y los headers de firma, nada más", async () => {
    // Espacios y orden de claves raros a propósito: reparsear el JSON rompería la firma.
    const body = '{ "id":"evt_1",  "type":"x", "data":{"$weird.key":1} }';
    const res = await request(front)
      .post("/api/v1/billing/webhook")
      .set("content-type", "application/json; charset=utf-8")
      .set("stripe-signature", "t=1,v1=abc")
      .set("cookie", "no=pasa")
      .set("x-otro", "tampoco")
      .send(body);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { received: true, duplicate: false });
    assert.equal(back.received.length, 1);
    const [got] = back.received;
    assert.equal(got.body.toString("utf8"), body);
    assert.equal(got.headers["stripe-signature"], "t=1,v1=abc");
    assert.equal(got.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(got.headers.cookie, undefined);
    assert.equal(got.headers["x-otro"], undefined);
    assert.equal(got.headers.authorization, undefined);
  });

  it("las rutas JWT de billing sin token dan 401 sin llegar al Backend", async () => {
    for (const [method, path] of [
      ["get", "/billing/plan"],
      ["post", "/billing/subscribe"],
      ["post", "/billing/cancel"],
    ] as const) {
      const res = await request(front)[method](`/api/v1${path}`);
      assert.equal(res.status, 401);
    }
    assert.equal(back.received.length, 0);
  });
});
