import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { AppError, errorHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
import { apiRouter } from "../src/routes";
import { captureLogger, listen } from "./helpers";

type Envelope = { error: { code: string; message: string; requestId: string } };

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Arma un JWT a mano para poder probar algoritmos y firmas que jsonwebtoken no emitiría. */
function makeToken(
  claims: Record<string, unknown>,
  key: KeyObject | null,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT" },
): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(header)}.${b64url({ iat: now, exp: now + 900, ...claims })}`;
  const signature = key ? sign("sha256", Buffer.from(unsigned), key).toString("base64url") : "";
  return `${unsigned}.${signature}`;
}

const me = {
  id: "66f1a0000000000000000001",
  email: "cami@example.com",
  targets: { kcal: 2093, proteinG: 108, carbsG: 285, fatG: 58 },
};

function fakeBackend() {
  const { logger } = captureLogger("back");
  const received: { method: string; path: string; body: unknown; authorization?: string }[] = [];
  const app = express();
  app.use(requestContext({ logger, trustIncomingId: true }));
  app.use(express.json());
  app.use((req, _res, next) => {
    received.push({
      method: req.method,
      path: req.path,
      body: req.body,
      authorization: req.get("authorization"),
    });
    next();
  });
  app.post("/api/v1/auth/refresh", (req, res) => {
    if (req.body.refreshToken === "rotado") throw new AppError("UNAUTHORIZED");
    res.json({ accessToken: "a2", refreshToken: "r2", user: { id: me.id, email: me.email } });
  });
  app.post("/api/v1/auth/logout", (_req, res) => {
    res.status(204).end();
  });
  app.get("/api/v1/users/me", (_req, res) => {
    res.json(me);
  });
  app.patch("/api/v1/users/me", (req, res) => {
    res.json({ ...me, profile: req.body.profile });
  });
  app.delete("/api/v1/users/me", (_req, res) => {
    res.status(204).end();
  });
  app.use(errorHandler({ logger }));
  return { app, received };
}

describe("front-service: JWT, refresh, logout y /users/me", () => {
  const back = fakeBackend();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const valid = makeToken({ sub: me.id, plan: "free" }, privateKey);
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

  const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
    fetch(`${frontUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined && { "content-type": "application/json" }),
        ...(opts.token !== undefined && { authorization: `Bearer ${opts.token}` }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

  async function assertRejected(res: Response, status: number, code: string) {
    assert.equal(res.status, status);
    const body = (await res.json()) as Envelope;
    assert.equal(body.error.code, code);
    assert.equal(body.error.requestId, res.headers.get("x-request-id"));
    assert.equal(back.received.length, 0, "no tenía que llegar al Backend");
  }

  it("GET /users/me con token válido reenvía el mismo token y devuelve la respuesta tal cual", async () => {
    const res = await call("GET", "/users/me", { token: valid });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), me);
    assert.equal(back.received[0].authorization, `Bearer ${valid}`);
  });

  it("sin Authorization → 401 sin llegar al Backend", async () => {
    await assertRejected(await call("GET", "/users/me"), 401, "UNAUTHORIZED");
  });

  for (const [caso, header] of [
    ["esquema que no es Bearer", `Basic ${valid}`],
    ["Bearer vacío", "Bearer "],
  ]) {
    it(`${caso} → 401`, async () => {
      const res = await fetch(`${frontUrl}/api/v1/users/me`, {
        headers: { authorization: header },
      });
      await assertRejected(res, 401, "UNAUTHORIZED");
    });
  }

  const now = Math.floor(Date.now() / 1000);
  for (const [caso, token] of [
    ["basura", "no.es.unjwt"],
    ["firmado con otra clave", makeToken({ sub: me.id, plan: "free" }, other.privateKey)],
    ["alg none", makeToken({ sub: me.id, plan: "free" }, null, { alg: "none", typ: "JWT" })],
    ["sin plan válido", makeToken({ sub: me.id, plan: "gold" }, privateKey)],
    ["sin sub", makeToken({ plan: "free" }, privateKey)],
  ]) {
    it(`token ${caso} → 401 UNAUTHORIZED`, async () => {
      await assertRejected(await call("GET", "/users/me", { token }), 401, "UNAUTHORIZED");
    });
  }

  it("token vencido → 401 TOKEN_EXPIRED", async () => {
    const token = makeToken({ sub: me.id, plan: "free", exp: now - 60 }, privateKey);
    await assertRejected(await call("GET", "/users/me", { token }), 401, "TOKEN_EXPIRED");
  });

  it("query desconocida → 400 sin llegar al Backend", async () => {
    const res = await call("GET", "/users/me?admin=true", { token: valid });
    await assertRejected(res, 400, "VALIDATION_ERROR");
  });

  it("PATCH /users/me reenvía solo el body validado", async () => {
    const res = await call("PATCH", "/users/me", {
      token: valid,
      body: { profile: { weightKg: 58 } },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(back.received[0], {
      method: "PATCH",
      path: "/api/v1/users/me",
      body: { profile: { weightKg: 58 } },
      authorization: `Bearer ${valid}`,
    });
  });

  for (const [caso, body] of [
    ["campo desconocido", { profile: { weightKg: 58 }, plan: "premium" }],
    ["perfil vacío", { profile: {} }],
    ["fuera de rango", { profile: { heightCm: 20 } }],
  ]) {
    it(`PATCH /users/me con ${caso} → 400 sin llegar al Backend`, async () => {
      const res = await call("PATCH", "/users/me", { token: valid, body });
      await assertRejected(res, 400, "VALIDATION_ERROR");
    });
  }

  it("PATCH /users/me sin token → 401 aunque el body sea inválido", async () => {
    await assertRejected(await call("PATCH", "/users/me", { body: {} }), 401, "UNAUTHORIZED");
  });

  it("DELETE /users/me devuelve el 204 del Backend sin cuerpo", async () => {
    const res = await call("DELETE", "/users/me", { token: valid });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.equal(back.received[0].method, "DELETE");
  });

  it("refresh es público y no reenvía el Authorization del cliente", async () => {
    const res = await call("POST", "/auth/refresh", {
      token: "lo-que-sea",
      body: { refreshToken: "abc_DEF-123" },
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { accessToken: string }).accessToken, "a2");
    assert.deepEqual(back.received[0].body, { refreshToken: "abc_DEF-123" });
    assert.equal(back.received[0].authorization, undefined);
  });

  it("el 401 del Backend en refresh pasa sin modificar", async () => {
    const res = await call("POST", "/auth/refresh", { body: { refreshToken: "rotado" } });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as Envelope).error.code, "UNAUTHORIZED");
  });

  for (const [caso, body] of [
    ["sin refreshToken", {}],
    ["refreshToken que no es base64url", { refreshToken: "a b" }],
    ["campo de más", { refreshToken: "abc", userId: me.id }],
  ]) {
    it(`refresh ${caso} → 400 sin llegar al Backend`, async () => {
      await assertRejected(await call("POST", "/auth/refresh", { body }), 400, "VALIDATION_ERROR");
    });
  }

  it("logout requiere JWT", async () => {
    const res = await call("POST", "/auth/logout", { body: { refreshToken: "abc" } });
    await assertRejected(res, 401, "UNAUTHORIZED");
  });

  it("logout con JWT reenvía token y refresh, y devuelve 204", async () => {
    const res = await call("POST", "/auth/logout", { token: valid, body: { refreshToken: "abc" } });
    assert.equal(res.status, 204);
    assert.deepEqual(back.received[0].body, { refreshToken: "abc" });
    assert.equal(back.received[0].authorization, `Bearer ${valid}`);
  });

  it("register con query desconocida → 400", async () => {
    await assertRejected(
      await call("POST", "/auth/register?x=1", { body: {} }),
      400,
      "VALIDATION_ERROR",
    );
  });
});

describe("front-service: aislamiento", () => {
  it("no depende de drivers de Mongo, Redis ni colas", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    for (const dep of ["mongoose", "mongodb", "ioredis", "redis", "bullmq"]) {
      assert.ok(!(dep in pkg.dependencies), `front-service no debería depender de ${dep}`);
    }
  });

  it("en docker compose no comparte red con Mongo ni Redis, ni recibe credenciales de datos", () => {
    const compose = readFileSync(join(__dirname, "../../infra/docker-compose.yml"), "utf8");
    const service = (name: string) =>
      new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  \\w|\\nnetworks:)`).exec(compose)?.[1] ?? "";
    const networks = (name: string) =>
      [
        ...(/networks:\n((?: {6}- .+\n?)+)/.exec(service(name))?.[1] ?? "").matchAll(/- (\S+)/g),
      ].map((m) => m[1]);

    const front = networks("front");
    assert.ok(front.length > 0);
    for (const db of ["mongo", "redis"]) {
      for (const net of networks(db))
        assert.ok(!front.includes(net), `front comparte ${net} con ${db}`);
    }
    // Ni clave privada, ni Mongo/Redis, ni storage, ni IA; y sin env_file, que metería todo el .env.
    const frontService = service("front");
    for (const forbidden of [
      /PRIVATE_KEY/,
      /MONGO/,
      /REDIS/,
      /STORAGE|S3_|BUCKET/,
      /AI_/,
      /env_file/,
    ]) {
      assert.ok(!forbidden.test(frontService), `el contenedor front recibe ${forbidden}`);
    }
    const allowed = ["PORT", "BACKEND_URL", "BACKEND_TIMEOUT_MS", "JWT_PUBLIC_KEY", "LOG_LEVEL"];
    const vars = [...frontService.matchAll(/^ {6}([A-Z_]+):/gm)].map((m) => m[1]);
    assert.ok(vars.includes("JWT_PUBLIC_KEY"));
    for (const name of vars) assert.ok(allowed.includes(name), `variable inesperada: ${name}`);
  });
});
