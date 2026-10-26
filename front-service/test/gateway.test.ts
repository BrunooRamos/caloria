import assert from "node:assert/strict";
import { constants, createHmac, generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import express, { Router } from "express";
import type { Request, Response } from "express";
import request from "supertest";
import { AppError, errorHandler, requestContext } from "@caloria/shared";
import { createApp } from "../src/app";
import { createBackendClient } from "../src/clients/backend";
import { API_ROUTES, apiRouter } from "../src/routes";
import { captureLogger, listen, UUID } from "./helpers";

type Envelope = { error: { code: string; message: string; requestId: string } };

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

const USER_ID = "66f1a0000000000000000001";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

type Signer = (data: Buffer) => Buffer;
const rs256 =
  (key: KeyObject): Signer =>
  (data) =>
    sign("sha256", data, key);

/** JWT armado a mano para poder probar algoritmos y claims que el Backend nunca emitiría. */
function makeToken(
  claims: Record<string, unknown> = {},
  alg = "RS256",
  signer: Signer = rs256(keys.privateKey),
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: USER_ID, plan: "free", iat: now, exp: now + 900, ...claims };
  const unsigned = `${b64url({ alg, typ: "JWT" })}.${b64url(payload)}`;
  return `${unsigned}.${signer(Buffer.from(unsigned)).toString("base64url")}`;
}

const valid = makeToken();
const expiredAt = Math.floor(Date.now() / 1000) - 60;

const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
};
const authResponse = {
  accessToken: "a",
  refreshToken: "r",
  user: { id: USER_ID, email: "x@y.co" },
};
const me = { id: USER_ID, email: "cami@example.com", profile, tone: "neutro" };

interface Received {
  method: string;
  path: string;
  query: unknown;
  body: unknown;
  authorization?: string;
  requestId?: string;
}

type Handler = (req: Request, res: Response) => void;

/** Imita al Backend: cada ruta responde como el real, y un test puede cambiar la respuesta. */
const defaultHandler: Handler = (req, res) => {
  switch (`${req.method} ${req.path}`) {
    case "POST /api/v1/auth/register":
      return void res.status(201).json(authResponse);
    case "POST /api/v1/auth/logout":
    case "DELETE /api/v1/users/me":
      return void res.status(204).end();
    case "POST /api/v1/auth/login":
    case "POST /api/v1/auth/refresh":
      return void res.json(authResponse);
    default:
      res.json(me);
  }
};

function fakeBackend() {
  const { logger } = captureLogger("back");
  const received: Received[] = [];
  let handler = defaultHandler;
  const app = express();
  app.use(requestContext({ logger, trustIncomingId: true }));
  app.use(express.json());
  app.use((req, _res, next) => {
    received.push({
      method: req.method,
      path: req.path,
      query: { ...req.query },
      body: req.body,
      authorization: req.get("authorization"),
      requestId: req.get("x-request-id"),
    });
    next();
  });
  app.all("/api/v1/{*path}", (req, res) => handler(req, res));
  app.use(errorHandler({ logger }));
  return {
    app,
    received,
    respondWith(next: Handler) {
      handler = next;
    },
    reset() {
      received.length = 0;
      handler = defaultHandler;
    },
  };
}

function frontFor(backendUrl: string, timeoutMs = 2000) {
  const { logger, lines } = captureLogger("front");
  const client = createBackendClient({ baseUrl: backendUrl, timeoutMs });
  return { app: createApp({ logger, api: apiRouter(client, keys.publicKey) }), lines };
}

function expectEnvelope(res: request.Response, status: number, code: string) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  const { error } = res.body as Envelope;
  assert.equal(error.code, code);
  assert.equal(error.requestId, res.headers["x-request-id"]);
  assert.match(error.requestId, UUID);
}

describe("front-service: gateway de /api/v1", () => {
  const back = fakeBackend();
  let backUrl: string;
  let closeBack: () => Promise<void>;
  let front: ReturnType<typeof frontFor>;

  before(async () => {
    ({ url: backUrl, close: closeBack } = await listen(back.app));
    front = frontFor(backUrl);
  });
  after(async () => {
    await closeBack();
  });
  beforeEach(() => {
    back.reset();
    front.lines.length = 0;
  });

  const call = (method: "get" | "post" | "patch" | "delete", path: string, token?: string) => {
    const req = request(front.app)[method](`/api/v1${path}`);
    return token === undefined ? req : req.set("authorization", `Bearer ${token}`);
  };

  const assertNotForwarded = () => assert.equal(back.received.length, 0, "llegó al Backend");

  describe("JWT", () => {
    const publicBodies: Record<string, object> = {
      "/auth/register": { email: "cami@example.com", password: "12345678", profile },
      "/auth/login": { email: "cami@example.com", password: "lo-que-sea" },
      "/auth/refresh": { refreshToken: "abc_DEF-123" },
    };

    for (const route of API_ROUTES.filter((r) => r.access === "public")) {
      it(`${route.method.toUpperCase()} ${route.path} es pública: sin token llega al Backend`, async () => {
        const res = await call(route.method, route.path).send(publicBodies[route.path]);
        assert.ok(res.status < 400, `respondió ${res.status}`);
        assert.equal(back.received.length, 1);
        assert.equal(back.received[0].authorization, undefined);
      });
    }

    it("refresh con un access vencido en el header igual funciona y no lo reenvía", async () => {
      const expired = makeToken({ exp: expiredAt });
      const res = await call("post", "/auth/refresh", expired).send({ refreshToken: "abc" });
      assert.equal(res.status, 200);
      assert.equal(back.received[0].authorization, undefined);
    });

    for (const route of API_ROUTES.filter((r) => r.access === "jwt")) {
      it(`${route.method.toUpperCase()} ${route.path} sin token → 401 UNAUTHORIZED`, async () => {
        expectEnvelope(await call(route.method, route.path), 401, "UNAUTHORIZED");
        assertNotForwarded();
      });

      it(`${route.method.toUpperCase()} ${route.path} con token vencido → 401 TOKEN_EXPIRED`, async () => {
        const expired = makeToken({ exp: expiredAt });
        expectEnvelope(await call(route.method, route.path, expired), 401, "TOKEN_EXPIRED");
        assertNotForwarded();
      });
    }

    const pss: Signer = (data) =>
      sign("sha256", data, {
        key: keys.privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      });
    const rejectedTokens: [string, string][] = [
      ["firmado con otra clave", makeToken({}, "RS256", rs256(other.privateKey))],
      ["con la firma alterada", `${valid.slice(0, -4)}AAAA`],
      [
        "con el payload alterado",
        valid.replace(/\.[^.]+\./, `.${b64url({ sub: USER_ID, plan: "premium" })}.`),
      ],
      // Confusión de algoritmo: HMAC con la clave pública (que es pública) como secreto.
      [
        "HS256 con la clave pública como secreto",
        makeToken({}, "HS256", (d) => createHmac("sha256", publicPem).update(d).digest()),
      ],
      [
        "RS512 con la clave correcta",
        makeToken({}, "RS512", (d) => sign("sha512", d, keys.privateKey)),
      ],
      ["PS256 con la clave correcta", makeToken({}, "PS256", pss)],
      ["alg none", makeToken({}, "none", () => Buffer.alloc(0))],
      ["sin exp", makeToken({ exp: undefined })],
      [
        "vencido y firmado con otra clave",
        makeToken({ exp: expiredAt }, "RS256", rs256(other.privateKey)),
      ],
      [
        "vencido y en HS256",
        makeToken({ exp: expiredAt }, "HS256", (d) =>
          createHmac("sha256", publicPem).update(d).digest(),
        ),
      ],
      ["que no es un JWT", "no.es.unjwt"],
    ];
    for (const [caso, token] of rejectedTokens) {
      it(`token ${caso} → 401 UNAUTHORIZED`, async () => {
        expectEnvelope(await call("get", "/users/me", token), 401, "UNAUTHORIZED");
        assertNotForwarded();
      });
    }

    it("un token válido llega al Backend en el mismo Authorization", async () => {
      const res = await call("get", "/users/me", valid);
      assert.equal(res.status, 200);
      assert.equal(back.received[0].authorization, `Bearer ${valid}`);
    });
  });

  describe("validación", () => {
    const invalidBodies: [string, "post" | "patch", string, unknown][] = [
      ["register sin perfil", "post", "/auth/register", { email: "a@b.co", password: "12345678" }],
      [
        "register con email inválido",
        "post",
        "/auth/register",
        { email: "no-es-email", password: "12345678", profile },
      ],
      [
        "register con 15 años",
        "post",
        "/auth/register",
        {
          email: "a@b.co",
          password: "12345678",
          profile: { ...profile, birthDate: `${new Date().getUTCFullYear() - 15}-01-01` },
        },
      ],
      ["login sin password", "post", "/auth/login", { email: "a@b.co" }],
      [
        "login con un campo de más",
        "post",
        "/auth/login",
        { email: "a@b.co", password: "x", admin: true },
      ],
      ["PATCH vacío", "patch", "/users/me", {}],
      ["PATCH con tono inválido", "patch", "/users/me", { tone: "sarcastico" }],
      ["PATCH con push token inválido", "patch", "/users/me", { pushTokens: ["abc"] }],
      ["PATCH con plan", "patch", "/users/me", { plan: "premium" }],
    ];
    for (const [caso, method, path, body] of invalidBodies) {
      it(`${caso} → 400 VALIDATION_ERROR sin llegar al Backend`, async () => {
        const res = await call(method, path, valid).send(body as object);
        expectEnvelope(res, 400, "VALIDATION_ERROR");
        assert.equal((res.body as Envelope).error.message, "La solicitud no es válida");
        assertNotForwarded();
      });
    }

    const operatorBodies: [string, "post" | "patch", string, unknown][] = [
      ["login con $ne en el email", "post", "/auth/login", { email: { $ne: null }, password: "x" }],
      ["login con $where", "post", "/auth/login", { email: "a@b.co", password: "x", $where: "1" }],
      [
        "register con $gt dentro del perfil",
        "post",
        "/auth/register",
        { email: "a@b.co", password: "12345678", profile: { ...profile, heightCm: { $gt: 0 } } },
      ],
      [
        "refresh con $set",
        "post",
        "/auth/refresh",
        { refreshToken: "abc", $set: { plan: "premium" } },
      ],
      ["PATCH con clave con punto", "patch", "/users/me", { "profile.weightKg": 58 }],
      ["PATCH con $set anidado", "patch", "/users/me", { profile: { $set: { weightKg: 58 } } }],
    ];
    for (const [caso, method, path, body] of operatorBodies) {
      it(`${caso} → 400 VALIDATION_ERROR sin llegar al Backend`, async () => {
        expectEnvelope(
          await call(method, path, valid).send(body as object),
          400,
          "VALIDATION_ERROR",
        );
        assertNotForwarded();
      });
    }

    for (const query of ["$where=1", "a.b=1", "admin=true"]) {
      it(`query ?${query} → 400 VALIDATION_ERROR`, async () => {
        expectEnvelope(await call("get", `/users/me?${query}`, valid), 400, "VALIDATION_ERROR");
        assertNotForwarded();
      });
    }

    it("sin token, un body con $ es 401 y no 400: el JWT va primero", async () => {
      const res = await call("patch", "/users/me").send({ $where: "1" });
      expectEnvelope(res, 401, "UNAUTHORIZED");
    });

    it("body de más de 100 KB → 413 PAYLOAD_TOO_LARGE sin llegar al Backend", async () => {
      const res = await call("post", "/auth/login").send({
        email: "a@b.co",
        password: "x".repeat(101 * 1024),
      });
      expectEnvelope(res, 413, "PAYLOAD_TOO_LARGE");
      assertNotForwarded();
    });

    it("un body de casi 100 KB pasa el límite (y lo frena zod, no el parser)", async () => {
      const res = await call("post", "/auth/login").send({
        email: "a@b.co",
        password: "x".repeat(99 * 1024),
      });
      expectEnvelope(res, 400, "VALIDATION_ERROR");
    });

    it("PATCH reenvía solo lo validado: tono y push tokens incluidos", async () => {
      const body = {
        profile: { weightKg: 58 },
        tone: "roast",
        pushTokens: ["ExponentPushToken[abc_DEF-123]"],
      };
      const res = await call("patch", "/users/me", valid).send(body);
      assert.equal(res.status, 200);
      assert.deepEqual(back.received[0].body, body);
    });
  });

  describe("reenvío de la respuesta", () => {
    it("status, body y Content-Type tal cual (201 del register)", async () => {
      const res = await call("post", "/auth/register").send({
        email: "cami@example.com",
        password: "12345678",
        profile,
      });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, authResponse);
      assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    });

    it("204 sin cuerpo (logout)", async () => {
      const res = await call("post", "/auth/logout", valid).send({ refreshToken: "abc" });
      assert.equal(res.status, 204);
      assert.equal(res.text, "");
    });

    for (const [code, retryAfter] of [
      ["RATE_LIMITED", "30"],
      ["AI_UNAVAILABLE", "120"],
    ] as const) {
      it(`error ${code} del Backend: mismo status, mismo sobre y mismo Retry-After`, async () => {
        back.respondWith((_req, res) => {
          res.set("Retry-After", retryAfter);
          throw new AppError(code);
        });
        const res = await call("get", "/users/me", valid);
        const requestId = res.headers["x-request-id"];
        assert.equal(res.status, code === "RATE_LIMITED" ? 429 : 503);
        assert.equal(res.headers["retry-after"], retryAfter);
        assert.deepEqual(res.body, {
          error: { code, message: new AppError(code).message, requestId },
        });
      });
    }

    it("reenvía Cache-Control y Content-Type, pero no headers internos ni cookies", async () => {
      back.respondWith((_req, res) => {
        res
          .set("Cache-Control", "no-store")
          .set("Set-Cookie", "sesion=1")
          .set("X-Interno", "back-1")
          .set("Location", "http://back:4000/api/v1/users/me")
          .type("application/json; charset=utf-8")
          .send(JSON.stringify(me));
      });
      const res = await call("get", "/users/me", valid);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, me);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
      for (const header of ["set-cookie", "x-interno", "location"]) {
        assert.equal(res.headers[header], undefined, `se filtró ${header}`);
      }
    });

    it("un redirect del Backend no se sigue → 500 INTERNAL_ERROR", async () => {
      back.respondWith((req, res) => {
        if (req.path === "/api/v1/seguido") return void res.json({ seguido: true });
        res.redirect(302, "/api/v1/seguido");
      });
      expectEnvelope(await call("get", "/users/me", valid), 500, "INTERNAL_ERROR");
      assert.deepEqual(
        back.received.map((r) => r.path),
        ["/api/v1/users/me"],
      );
    });

    it("el cliente reenvía método, ruta y query", async () => {
      const client = createBackendClient({ baseUrl: backUrl, timeoutMs: 2000 });
      const requestId = "11111111-1111-4111-8111-111111111111";
      await client.request({
        method: "GET",
        path: "/api/v1/meals",
        requestId,
        query: { date: "2026-10-19", tag: ["a", "b"] },
      });
      assert.deepEqual(back.received[0], {
        method: "GET",
        path: "/api/v1/meals",
        query: { date: "2026-10-19", tag: ["a", "b"] },
        body: undefined,
        authorization: undefined,
        requestId,
      });
    });
  });

  describe("GET /meals/:id", () => {
    const MEAL_ID = "66f1a0000000000000000099";
    const meal = {
      id: MEAL_ID,
      status: "processing",
      capturedAt: "2026-10-06T13:05:00.000Z",
      photoUrl: "http://localhost:9000/caloria-media/x?X-Amz-Expires=900",
    };

    it("reenvía al Backend con el id en la ruta y devuelve su respuesta sin caché", async () => {
      back.respondWith((_req, res) => void res.set("Cache-Control", "no-store").json(meal));
      const res = await call("get", `/meals/${MEAL_ID}`, valid);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, meal);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(back.received.length, 1);
      assert.equal(back.received[0].method, "GET");
      assert.equal(back.received[0].path, `/api/v1/meals/${MEAL_ID}`);
      assert.equal(back.received[0].authorization, `Bearer ${valid}`);
    });

    it("el 404 del Backend llega sin modificar", async () => {
      back.respondWith(
        (req, res) =>
          void res.status(404).json({
            error: { code: "NOT_FOUND", message: "Recurso inexistente", requestId: req.requestId },
          }),
      );
      const res = await call("get", `/meals/${MEAL_ID}`, valid);
      expectEnvelope(res, 404, "NOT_FOUND");
      assert.equal((res.body as Envelope).error.message, "Recurso inexistente");
    });

    const invalidIds: [string, string][] = [
      ["muy corto", "123"],
      ["con caracteres que no son hex", "66f1a000000000000000009z"],
      ["de 12 caracteres", "aaaaaaaaaaaa"],
      ["con un operador", encodeURIComponent('{"$gt":""}')],
      ["con un punto", "66f1a000000000000000.099"],
    ];
    for (const [caso, id] of invalidIds) {
      it(`id ${caso} → 400 VALIDATION_ERROR sin llegar al Backend`, async () => {
        expectEnvelope(await call("get", `/meals/${id}`, valid), 400, "VALIDATION_ERROR");
        assertNotForwarded();
      });
    }

    it("con query string → 400 VALIDATION_ERROR sin llegar al Backend", async () => {
      expectEnvelope(await call("get", `/meals/${MEAL_ID}?x=1`, valid), 400, "VALIDATION_ERROR");
      assertNotForwarded();
    });
  });

  describe("X-Request-Id", () => {
    it("el Front genera el suyo, ignora el del cliente y lo propaga al Backend y a sus logs", async () => {
      const clientId = "22222222-2222-4222-8222-222222222222";
      const res = await call("get", "/users/me", valid).set("x-request-id", clientId);
      const requestId = res.headers["x-request-id"];
      assert.match(requestId, UUID);
      assert.notEqual(requestId, clientId);
      assert.equal(back.received[0].requestId, requestId);
      const line = front.lines.find((l) => l.msg === "request" && l.requestId === requestId);
      assert.ok(line, "falta la línea de la request en el log del Front");
      assert.equal(line.path, "/api/v1/users/me");
    });

    it("el requestId del sobre de un error del Backend es el mismo que generó el Front", async () => {
      back.respondWith(() => {
        throw new AppError("NOT_FOUND");
      });
      const res = await call("get", "/users/me", valid);
      expectEnvelope(res, 404, "NOT_FOUND");
      assert.equal(back.received[0].requestId, res.headers["x-request-id"]);
    });
  });

  describe("Backend no disponible", () => {
    it("caído → 503 SERVICE_UNAVAILABLE con el sobre estándar y sin detalles internos", async () => {
      const dead = await listen(express());
      await dead.close();
      const { app, lines } = frontFor(dead.url);
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("authorization", `Bearer ${valid}`);
      expectEnvelope(res, 503, "SERVICE_UNAVAILABLE");
      assert.equal((res.body as Envelope).error.message, "Servicio no disponible");
      assert.ok(!res.text.includes("ECONNREFUSED"));
      assert.ok(lines.some((l) => l.level === "error" && l.code === "SERVICE_UNAVAILABLE"));
    });

    it("no responde a tiempo → 503 SERVICE_UNAVAILABLE al vencer el timeout", async () => {
      back.respondWith((_req, res) => {
        setTimeout(() => res.json(me), 400);
      });
      const { app } = frontFor(backUrl, 100);
      const start = Date.now();
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("authorization", `Bearer ${valid}`);
      expectEnvelope(res, 503, "SERVICE_UNAVAILABLE");
      assert.ok(Date.now() - start < 400, "esperó al Backend en vez de cortar");
    });

    it("se corta mientras manda el body de un 200 → 503, no un 200 vacío", async () => {
      back.respondWith((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"id":');
        setTimeout(() => res.end('"x"}'), 400);
      });
      const { app } = frontFor(backUrl, 100);
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("authorization", `Bearer ${valid}`);
      expectEnvelope(res, 503, "SERVICE_UNAVAILABLE");
    });

    it("corta la conexión a mitad del body → 503", async () => {
      back.respondWith((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"id":');
        setTimeout(() => res.socket?.destroy(), 20);
      });
      expectEnvelope(await call("get", "/users/me", valid), 503, "SERVICE_UNAVAILABLE");
    });
  });

  describe("logs", () => {
    it("no incluyen passwords, emails, tokens ni bodies", async () => {
      const secrets = {
        email: "Persona.Secreta@Example.com",
        password: "contraseña-super-secreta",
        refreshToken: "refresh_SECRETO_abc123",
      };
      await call("post", "/auth/register").send({
        email: secrets.email,
        password: secrets.password,
        profile,
      });
      await call("post", "/auth/login").send({ email: secrets.email, password: secrets.password });
      await call("post", "/auth/refresh").send({ refreshToken: secrets.refreshToken });
      await call("post", "/auth/logout", valid).send({ refreshToken: secrets.refreshToken });
      await call("patch", "/users/me", valid).send({ profile: { weightKg: 58 } });
      // También cuando falla: un 400 y un error del Backend.
      await call("post", "/auth/login").send({ email: secrets.email, password: 1 });
      back.respondWith(() => {
        throw new AppError("UNAUTHORIZED");
      });
      await call("post", "/auth/login").send({ email: secrets.email, password: secrets.password });

      const raw = JSON.stringify(front.lines);
      assert.ok(front.lines.length >= 7);
      for (const leak of [
        secrets.email,
        secrets.email.toLowerCase(),
        secrets.password,
        secrets.refreshToken,
        valid,
        valid.split(".")[2],
        "America/Montevideo",
      ]) {
        assert.ok(!raw.includes(leak), `el log incluye ${leak}`);
      }
    });
  });
});

describe("front-service: trust proxy", () => {
  const { logger } = captureLogger("front");
  const probe = Router();
  probe.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  const app = createApp({ logger, api: probe });

  it("toma la IP que agregó nginx, la última de X-Forwarded-For", async () => {
    const res = await request(app).get("/api/v1/ip").set("x-forwarded-for", "203.0.113.7");
    assert.equal(res.body.ip, "203.0.113.7");
  });

  it("no le cree al cliente si manda su propio X-Forwarded-For", async () => {
    // nginx agrega la IP real al final de lo que mandó el cliente.
    const res = await request(app).get("/api/v1/ip").set("x-forwarded-for", "6.6.6.6, 203.0.113.7");
    assert.equal(res.body.ip, "203.0.113.7");
  });
});
