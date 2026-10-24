import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { AppError, errorHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
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

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** Access token RS256 firmado a mano: el Front no depende de jsonwebtoken. */
function accessToken(claims: Record<string, unknown>, ttlSeconds = 900): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat, exp: iat + ttlSeconds, ...claims })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`;
}

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
  app.post("/api/v1/auth/refresh", (req, res) => {
    received.push({ path: req.path, body: req.body, headers: req.headers });
    if (req.body.refreshToken === "usado") throw new AppError("UNAUTHORIZED");
    res.json({ accessToken: "a2", refreshToken: "r2", user: { id: "1", email: "x@example.com" } });
  });
  app.post("/api/v1/auth/logout", (req, res) => {
    received.push({ path: req.path, body: req.body, headers: req.headers });
    res.status(204).end();
  });
  app.use(errorHandler({ logger }));
  return { app, received };
}

describe("front-service: rutas /auth", () => {
  const back = fakeBackend();
  const { publicKey } = keys;
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

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${frontUrl}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("register es público: reenvía al Backend el body validado y normalizado, y devuelve 201", async () => {
    const res = await post("register", {
      email: "  Juan@Example.com ",
      password: "12345678",
      profile,
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

  it("register con un campo de más (p. ej. plan) → 400 sin llegar al Backend", async () => {
    const res = await post("register", {
      email: "juan@example.com",
      password: "12345678",
      profile,
      plan: "premium",
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as Envelope).error.code, "VALIDATION_ERROR");
    assert.equal(back.received.length, 0);
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

  it("refresh es público: no exige JWT, no reenvía el Authorization y devuelve el par nuevo", async () => {
    const res = await post(
      "refresh",
      { refreshToken: "r1" },
      { authorization: "Bearer cualquiera" },
    );
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { refreshToken: string }).refreshToken, "r2");
    assert.deepEqual(back.received[0].body, { refreshToken: "r1" });
    assert.equal(back.received[0].headers.authorization, undefined);
  });

  it("refresh con body inválido o campos de más → 400 sin llegar al Backend", async () => {
    for (const body of [
      {},
      { refreshToken: "" },
      { refreshToken: 1 },
      { refreshToken: "r1", x: 1 },
    ]) {
      const res = await post("refresh", body);
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as Envelope).error.code, "VALIDATION_ERROR");
    }
    assert.equal(back.received.length, 0);
  });

  it("el 401 del refresh del Backend pasa sin modificar", async () => {
    const res = await post("refresh", { refreshToken: "usado" });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as Envelope).error.code, "UNAUTHORIZED");
  });

  it("logout con JWT válido reenvía el Authorization y el body, y devuelve 204 sin cuerpo", async () => {
    const token = accessToken({ sub: "66f1a0000000000000000001", plan: "free" });
    const res = await post("logout", { refreshToken: "r1" }, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.deepEqual(back.received[0].body, { refreshToken: "r1" });
    assert.equal(back.received[0].headers.authorization, `Bearer ${token}`);
  });

  it("logout sin JWT, con uno inválido o vencido → 401 sin llegar al Backend", async () => {
    const expired = accessToken({ sub: "u1", plan: "free" }, -10);
    const cases: [Record<string, string>, string][] = [
      [{}, "UNAUTHORIZED"],
      [{ authorization: "Bearer basura" }, "UNAUTHORIZED"],
      [{ authorization: `Bearer ${expired}` }, "TOKEN_EXPIRED"],
    ];
    for (const [headers, code] of cases) {
      const res = await post("logout", { refreshToken: "r1" }, headers);
      assert.equal(res.status, 401);
      assert.equal(((await res.json()) as Envelope).error.code, code);
    }
    assert.equal(back.received.length, 0);
  });

  it("logout con JWT válido pero sin refreshToken → 400 sin llegar al Backend", async () => {
    const token = accessToken({ sub: "u1", plan: "free" });
    const res = await post("logout", {}, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 400);
    assert.equal(back.received.length, 0);
  });
});
