import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { AppError, errorHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
import { loadConfig } from "../src/config";
import { apiRouter } from "../src/routes";
import { captureLogger, listen } from "./helpers";

const profile = {
  sex: "male",
  birthDate: "1998-11-02",
  heightCm: 180,
  weightKg: 82,
  activity: "light",
  goal: "lose",
  timezone: "America/Montevideo",
};

type Envelope = { error: { code: string; message: string; requestId: string } };

function fakeBackend() {
  const { logger } = captureLogger("back");
  const received: { path: string; body: unknown; headers: Record<string, unknown> }[] = [];
  const app = express();
  app.use(requestContext({ logger, trustIncomingId: true }));
  app.use(express.json());
  app.post("/api/v1/auth/register", (req, res) => {
    received.push({ path: req.path, body: req.body, headers: req.headers });
    if (req.body.email === "repetido@example.com") throw new AppError("EMAIL_TAKEN");
    res
      .status(201)
      .json({ accessToken: "a", refreshToken: "r", user: { id: "1", email: req.body.email } });
  });
  app.post("/api/v1/auth/login", (req, _res) => {
    received.push({ path: req.path, body: req.body, headers: req.headers });
    throw new AppError("UNAUTHORIZED", "Email o contraseña incorrectos");
  });
  app.use(errorHandler({ logger }));
  return { app, received };
}

describe("front-service: /auth/register y /auth/login", () => {
  const back = fakeBackend();
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let frontUrl: string;
  let closeFront: () => Promise<void>;
  let closeBack: () => Promise<void>;

  before(async () => {
    const backend = await listen(back.app);
    closeBack = backend.close;
    const { logger } = captureLogger("front");
    const client = createBackendClient({ baseUrl: backend.url, timeoutMs: 2000 });
    ({ url: frontUrl, close: closeFront } = await listen(
      createApp({ logger, api: apiRouter(client, publicKey) }),
    ));
  });
  after(async () => {
    await closeFront();
    await closeBack();
  });
  beforeEach(() => {
    back.received.length = 0;
  });

  const post = (path: string, body: unknown) =>
    fetch(`${frontUrl}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("register es público: reenvía al Backend el body validado y normalizado, y devuelve 201", async () => {
    const res = await post("register", {
      email: "  Juan@Example.com ",
      password: "12345678",
      profile,
      plan: "premium",
    });
    assert.equal(res.status, 201);
    assert.equal(back.received.length, 1);
    assert.deepEqual(back.received[0].body, {
      email: "juan@example.com",
      password: "12345678",
      profile,
    });
    assert.equal(back.received[0].headers["x-request-id"], res.headers.get("x-request-id"));
    assert.equal(back.received[0].headers.authorization, undefined);
  });

  for (const [caso, password] of [
    ["7 bytes", "a".repeat(7)],
    ["73 bytes", "a".repeat(73)],
  ]) {
    it(`contraseña de ${caso} → 400 sin llegar al Backend`, async () => {
      const res = await post("register", { email: "juan@example.com", password, profile });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as Envelope).error.code, "VALIDATION_ERROR");
      assert.equal(back.received.length, 0);
    });
  }

  it("409 EMAIL_TAKEN del Backend pasa sin modificar", async () => {
    const res = await post("register", {
      email: "REPETIDO@example.com",
      password: "12345678",
      profile,
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), {
      error: {
        code: "EMAIL_TAKEN",
        message: "El email ya está registrado",
        requestId: res.headers.get("x-request-id"),
      },
    });
  });

  it("login es público y el 401 del Backend pasa sin modificar", async () => {
    const res = await post("login", { email: "Juan@example.com", password: "lo-que-sea" });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as Envelope).error.message, "Email o contraseña incorrectos");
    assert.deepEqual(back.received[0].body, { email: "juan@example.com", password: "lo-que-sea" });
  });
});

describe("front-service: configuración", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("no arranca sin JWT_PUBLIC_KEY", () => {
    assert.throws(() => loadConfig({}), /JWT_PUBLIC_KEY/);
  });

  it("no acepta la clave privada en lugar de la pública", () => {
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    assert.throws(() => loadConfig({ JWT_PUBLIC_KEY: pem }), /clave privada/);
  });

  it("lee la clave pública del entorno", () => {
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.equal(loadConfig({ JWT_PUBLIC_KEY: pem }).jwtPublicKey.type, "public");
  });
});
