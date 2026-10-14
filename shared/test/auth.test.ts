import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import {
  ageOn,
  AppError,
  authClaims,
  errorHandler,
  loadPrivateKey,
  loadPublicKey,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  requestContext,
  requireAuth,
  verifyAccessToken,
} from "../src";
import { captureLogger, listen } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
};

function register(overrides: Record<string, unknown>) {
  return registerSchema.safeParse({
    email: "cami@example.com",
    password: "12345678",
    profile,
    ...overrides,
  });
}

function expectAppError(fn: () => unknown, code: string) {
  assert.throws(fn, (err) => err instanceof AppError && err.code === code);
}

describe("registerSchema", () => {
  it("aplica trim y minúsculas al email antes de validar", () => {
    const result = register({ email: "  Cami@Example.COM " });
    assert.equal(result.success, true);
    assert.equal(result.data?.email, "cami@example.com");
    assert.equal(register({ email: "no-es-email" }).success, false);
  });

  it("contraseña: 7 bytes no, 8 sí, 72 sí, 73 no", () => {
    assert.equal(register({ password: "a".repeat(7) }).success, false);
    assert.equal(register({ password: "a".repeat(8) }).success, true);
    assert.equal(register({ password: "a".repeat(72) }).success, true);
    assert.equal(register({ password: "a".repeat(73) }).success, false);
  });

  it("cuenta bytes y no caracteres para el máximo (bcrypt corta en 72 bytes)", () => {
    assert.equal(register({ password: "ñ".repeat(36) }).success, true); // 72 bytes
    assert.equal(register({ password: "ñ".repeat(37) }).success, false); // 74 bytes
    assert.equal(register({ password: "ñ".repeat(7) }).success, false); // 7 caracteres
  });

  it("valida los rangos del perfil", () => {
    const withProfile = (p: Record<string, unknown>) => register({ profile: { ...profile, ...p } });
    assert.equal(withProfile({ heightCm: 99 }).success, false);
    assert.equal(withProfile({ weightKg: 301 }).success, false);
    assert.equal(withProfile({ activity: "extreme" }).success, false);
    assert.equal(withProfile({ timezone: "Marte/Olympus" }).success, false);
    assert.equal(withProfile({ birthDate: "2002-02-30" }).success, false);
    const year = new Date().getUTCFullYear();
    assert.equal(withProfile({ birthDate: `${year - 10}-01-01` }).success, false);
    assert.equal(withProfile({ birthDate: `${year - 120}-01-01` }).success, false);
  });

  it("descarta claves desconocidas (p. ej. operadores de Mongo)", () => {
    const result = register({ $where: "1", plan: "premium" });
    assert.equal(result.success, true);
    assert.deepEqual(Object.keys(result.data ?? {}).sort(), ["email", "password", "profile"]);
  });

  it("ageOn cuenta el cumpleaños", () => {
    assert.equal(ageOn("2002-04-10", new Date("2026-04-09T12:00:00Z")), 23);
    assert.equal(ageOn("2002-04-10", new Date("2026-04-10T12:00:00Z")), 24);
  });
});

describe("loginSchema", () => {
  it("normaliza el email y no exige el mínimo de la contraseña", () => {
    const result = loginSchema.safeParse({ email: " CAMI@example.com", password: "corta" });
    assert.equal(result.success, true);
    assert.equal(result.data?.email, "cami@example.com");
    assert.equal(
      loginSchema.safeParse({ email: "a@b.co", password: "a".repeat(73) }).success,
      false,
    );
  });
});

describe("claves RS256 por variable de entorno", () => {
  it("carga PEM con saltos de línea reales o escapados", () => {
    const escaped = privatePem.replace(/\n/g, "\\n");
    assert.equal(loadPrivateKey("K", { K: privatePem }).asymmetricKeyType, "rsa");
    assert.equal(loadPrivateKey("K", { K: escaped }).asymmetricKeyType, "rsa");
    assert.equal(loadPublicKey("K", { K: publicPem }).type, "public");
  });

  it("falla si falta, si es inválida o si no es RSA ≥ 2048", () => {
    assert.throws(
      () => loadPrivateKey("JWT_PRIVATE_KEY", {}),
      /Falta la variable de entorno JWT_PRIVATE_KEY/,
    );
    assert.throws(() => loadPublicKey("K", { K: "   " }), /Falta/);
    assert.throws(() => loadPublicKey("K", { K: "basura" }), /no es una clave PEM válida/);
    assert.throws(() => loadPublicKey("K", { K: privatePem }), /contiene una clave privada/);
    assert.throws(() => loadPublicKey("K", { K: privatePem.replace(/PRIVATE/g, "PUBLIC") }));
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecPem = ec.publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.throws(() => loadPublicKey("K", { K: ecPem }), /RSA/);
    const small = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const smallPem = small.publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.throws(() => loadPublicKey("K", { K: smallPem }), /2048/);
  });
});

describe("verifyAccessToken", () => {
  const sign = (payload: object, options: jwt.SignOptions = {}) =>
    jwt.sign(payload, privateKey, { algorithm: "RS256", expiresIn: 900, ...options });

  it("acepta un token RS256 válido y devuelve sub y plan", () => {
    assert.deepEqual(verifyAccessToken(sign({ sub: "u1", plan: "free" }), publicKey), {
      sub: "u1",
      plan: "free",
    });
  });

  it("token vencido → TOKEN_EXPIRED", () => {
    const token = sign({ sub: "u1", plan: "free", iat: Math.floor(Date.now() / 1000) - 1000 });
    expectAppError(() => verifyAccessToken(token, publicKey), "TOKEN_EXPIRED");
  });

  it("rechaza alg: none", () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "u1", plan: "premium", exp })}.`;
    expectAppError(() => verifyAccessToken(token, publicKey), "UNAUTHORIZED");
  });

  it("rechaza HS256 firmado con la clave pública como secreto (confusión de algoritmo)", () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 900;
    const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", plan: "premium", exp })}`;
    const signature = createHmac("sha256", publicPem).update(unsigned).digest("base64url");
    expectAppError(() => verifyAccessToken(`${unsigned}.${signature}`, publicKey), "UNAUTHORIZED");
  });

  it("rechaza RS512 aunque la firma sea de la misma clave", () => {
    const token = sign({ sub: "u1", plan: "free" }, { algorithm: "RS512" });
    expectAppError(() => verifyAccessToken(token, publicKey), "UNAUTHORIZED");
  });

  it("rechaza un token firmado con otra clave privada", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = jwt.sign({ sub: "u1", plan: "free" }, other.privateKey, { algorithm: "RS256" });
    expectAppError(() => verifyAccessToken(token, publicKey), "UNAUTHORIZED");
  });

  it("rechaza un token sin sub o con un plan desconocido", () => {
    expectAppError(() => verifyAccessToken(sign({ plan: "free" }), publicKey), "UNAUTHORIZED");
    expectAppError(
      () => verifyAccessToken(sign({ sub: "u1", plan: "gold" }), publicKey),
      "UNAUTHORIZED",
    );
  });
});

describe("refreshTokenSchema", () => {
  it("acepta un string no vacío de hasta 256 caracteres y descarta campos extra", () => {
    assert.deepEqual(refreshTokenSchema.parse({ refreshToken: "abc", otro: 1 }), {
      refreshToken: "abc",
    });
    for (const refreshToken of ["", "a".repeat(257), 123, undefined]) {
      assert.equal(refreshTokenSchema.safeParse({ refreshToken }).success, false);
    }
  });
});

describe("requireAuth", () => {
  const { logger } = captureLogger();
  let url: string;
  let close: () => Promise<void>;

  before(async () => {
    const app = express();
    app.use(requestContext({ logger, trustIncomingId: false }));
    app.get("/privada", requireAuth(publicKey), (req, res) => {
      res.json(authClaims(req));
    });
    app.use(errorHandler({ logger }));
    ({ url, close } = await listen(app));
  });
  after(() => close());

  const get = (authorization?: string) =>
    fetch(`${url}/privada`, { headers: authorization ? { authorization } : {} });
  const codeOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;
  const sign = (payload: object, options: jwt.SignOptions = {}) =>
    jwt.sign(payload, privateKey, { algorithm: "RS256", expiresIn: 900, ...options });

  it("con Bearer válido deja los claims en req.auth", async () => {
    const res = await get(`Bearer ${sign({ sub: "u1", plan: "premium" })}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sub: "u1", plan: "premium" });
  });

  it("sin header, con otro esquema o con token inválido → 401 UNAUTHORIZED", async () => {
    const token = sign({ sub: "u1", plan: "free" });
    for (const header of [undefined, `Basic ${token}`, token, "Bearer ", "Bearer basura"]) {
      const res = await get(header);
      assert.equal(res.status, 401, String(header));
      assert.equal(await codeOf(res), "UNAUTHORIZED");
    }
  });

  it("token vencido → 401 TOKEN_EXPIRED", async () => {
    const res = await get(
      `Bearer ${sign({ sub: "u1", plan: "free", iat: Math.floor(Date.now() / 1000) - 1000 })}`,
    );
    assert.equal(res.status, 401);
    assert.equal(await codeOf(res), "TOKEN_EXPIRED");
  });
});
