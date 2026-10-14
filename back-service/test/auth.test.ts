import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { verifyAccessToken } from "@caloria/shared";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { UserModel as User } from "../src/models/User";
import { apiRouter } from "../src/routes";
import { createAuthService, MAX_SESSIONS } from "../src/services/auth";
import { createUserService } from "../src/services/users";
import { computeTargets } from "../src/services/targets";
import { captureLogger, listen } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

// Contraseñas generadas en cada corrida: no hay credenciales literales en el repo.
const PASSWORD = randomBytes(12).toString("base64url");
const WRONG_PASSWORD = randomBytes(12).toString("base64url");
const profile = {
  sex: "female",
  birthDate: "2002-04-10",
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
  timezone: "America/Montevideo",
};

type Envelope = { error: { code: string; message: string; requestId: string } };
type Tokens = { accessToken: string; refreshToken: string; user: { id: string; email: string } };

describe("back-service: POST /auth/register y /auth/login", () => {
  const { logger, lines } = captureLogger("back");
  let mongo: MongoMemoryServer;
  let url: string;
  let close: () => Promise<void>;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await User.init();
    const auth = createAuthService({ privateKey });
    ({ url, close } = await listen(
      createApp({ logger, api: apiRouter({ auth, users: createUserService(), publicKey }) }),
    ));
  });
  after(async () => {
    await close();
    await mongoose.disconnect();
    await mongo.stop();
  });
  beforeEach(() => User.deleteMany({}));

  const post = (path: string, body: unknown) =>
    fetch(`${url}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const register = (overrides: Record<string, unknown> = {}) =>
    post("register", { email: "cami@example.com", password: PASSWORD, profile, ...overrides });

  it("register → 201 con access y refresh token", async () => {
    const res = await register();
    assert.equal(res.status, 201);
    const body = (await res.json()) as Tokens;
    assert.deepEqual(Object.keys(body).sort(), ["accessToken", "refreshToken", "user"]);
    assert.equal(body.user.email, "cami@example.com");
    assert.match(body.user.id, /^[0-9a-f]{24}$/);
    assert.ok(body.refreshToken.length >= 43, "refresh de al menos 32 bytes en base64url");
  });

  it("el access token se verifica con la clave pública, dura 15 min y solo trae sub, plan, iat y exp", async () => {
    const { accessToken, user } = (await (await register()).json()) as Tokens;
    assert.deepEqual(verifyAccessToken(accessToken, publicKey), { sub: user.id, plan: "free" });

    const header = jwt.decode(accessToken, { complete: true })?.header;
    assert.equal(header?.alg, "RS256");
    const payload = jwt.decode(accessToken) as Record<string, number>;
    assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "plan", "sub"]);
    assert.equal(payload.exp - payload.iat, 15 * 60);
    assert.ok(!JSON.stringify(payload).includes("cami@example.com"));
  });

  it("guarda solo el hash bcrypt (cost 12) de la contraseña", async () => {
    await register();
    const stored = await User.findOne({ email: "cami@example.com" }).lean();
    assert.ok(stored);
    assert.notEqual(stored.passwordHash, PASSWORD);
    assert.match(stored.passwordHash, /^\$2[aby]\$12\$/);
    assert.equal(await bcrypt.compare(PASSWORD, stored.passwordHash), true);
    assert.ok(!JSON.stringify(stored).includes(PASSWORD));
  });

  it("guarda el refresh como hash SHA-256, con family y expiresAt a 30 días", async () => {
    const { refreshToken } = (await (await register()).json()) as Tokens;
    const stored = await User.findOne({ email: "cami@example.com" }).lean();
    assert.equal(stored?.sessions.length, 1);
    const [session] = stored!.sessions;
    assert.notEqual(session.tokenHash, refreshToken);
    assert.equal(session.tokenHash, createHash("sha256").update(refreshToken).digest("hex"));
    assert.ok(session.family);
    const days = (session.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 29.9 && days <= 30, `expira en ${days} días`);
  });

  it("guarda el email en minúsculas y sin espacios", async () => {
    const res = await register({ email: "  Cami@Example.COM " });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as Tokens).user.email, "cami@example.com");
    assert.equal(await User.countDocuments({ email: "cami@example.com" }), 1);
  });

  it("email repetido → 409 EMAIL_TAKEN, también si cambia mayúsculas", async () => {
    assert.equal((await register()).status, 201);
    for (const email of ["cami@example.com", "CAMI@Example.com"]) {
      const res = await register({ email });
      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as Envelope).error.code, "EMAIL_TAKEN");
    }
    assert.equal(await User.countDocuments(), 1);
  });

  it("dos registros simultáneos con el mismo email: uno 201 y otro 409", async () => {
    const statuses = (await Promise.all([register(), register({ email: "Cami@example.com" })]))
      .map((res) => res.status)
      .sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(await User.countDocuments(), 1);
  });

  it("contraseña de 7 o de 73 bytes → 400 VALIDATION_ERROR", async () => {
    for (const password of ["a".repeat(7), "a".repeat(73)]) {
      const res = await register({ password });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as Envelope).error.code, "VALIDATION_ERROR");
    }
    assert.equal(await User.countDocuments(), 0);
  });

  it("perfil fuera de rango → 400", async () => {
    const res = await register({ profile: { ...profile, heightCm: 20 } });
    assert.equal(res.status, 400);
  });

  it("login correcto → 200 con tokens nuevos y otra sesión guardada", async () => {
    await register();
    const res = await post("login", { email: " CAMI@example.com", password: PASSWORD });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Tokens;
    assert.equal(verifyAccessToken(body.accessToken, publicKey).plan, "free");
    const stored = await User.findOne({ email: "cami@example.com" }).lean();
    assert.equal(stored?.sessions.length, 2);
    assert.equal(
      stored?.sessions[1].tokenHash,
      createHash("sha256").update(body.refreshToken).digest("hex"),
    );
  });

  it("register guarda las metas calculadas según RF-02 y los valores por defecto", async () => {
    await register();
    const stored = await User.findOne({ email: "cami@example.com" }).lean();
    assert.deepEqual(stored?.targets, computeTargets(profile as never));
    assert.equal(stored?.tone, "neutro");
    assert.equal(stored?.usage.analyses, 0);
    assert.deepEqual(stored?.pushTokens, []);
  });

  it("login descarta las sesiones vencidas y deja como mucho MAX_SESSIONS", async () => {
    await register();
    const expired = { tokenHash: "viejo", family: "f", expiresAt: new Date(Date.now() - 1000) };
    await User.updateOne({ email: "cami@example.com" }, { $push: { sessions: expired } });

    for (let i = 0; i < MAX_SESSIONS + 2; i++) {
      assert.equal(
        (await post("login", { email: "cami@example.com", password: PASSWORD })).status,
        200,
      );
    }
    const stored = await User.findOne({ email: "cami@example.com" }).lean();
    assert.equal(stored?.sessions.length, MAX_SESSIONS);
    assert.ok(stored?.sessions.every((s) => s.expiresAt.getTime() > Date.now()));
  });

  it("login incorrecto → 401 con el mismo mensaje sea el email o la contraseña", async () => {
    await register();
    const wrongPassword = await post("login", {
      email: "cami@example.com",
      password: WRONG_PASSWORD,
    });
    const unknownEmail = await post("login", { email: "nadie@example.com", password: PASSWORD });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    const a = ((await wrongPassword.json()) as Envelope).error;
    const b = ((await unknownEmail.json()) as Envelope).error;
    assert.equal(a.code, "UNAUTHORIZED");
    assert.equal(b.code, "UNAUTHORIZED");
    assert.equal(a.message, b.message);
  });

  it("nunca loguea ni devuelve la contraseña ni su hash", async () => {
    const res = await register();
    await post("login", { email: "cami@example.com", password: PASSWORD });
    await post("login", { email: "cami@example.com", password: WRONG_PASSWORD });
    const body = JSON.stringify(await res.json());
    for (const leak of [PASSWORD, "$2b$", "passwordHash"]) {
      assert.ok(!body.includes(leak), `la respuesta filtra ${leak}`);
    }
    const logs = JSON.stringify(lines);
    for (const leak of [PASSWORD, WRONG_PASSWORD, "$2b$", "passwordHash", "cami@example.com"]) {
      assert.ok(!logs.includes(leak), `el log filtra ${leak}`);
    }
  });
});

describe("back-service: configuración", () => {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("no arranca sin JWT_PRIVATE_KEY", () => {
    assert.throws(() => loadConfig({ MONGO_URI: "mongodb://x" }), /JWT_PRIVATE_KEY/);
  });

  it("no arranca sin MONGO_URI", () => {
    assert.throws(() => loadConfig({ JWT_PRIVATE_KEY: pem }), /MONGO_URI/);
  });

  it("lee la clave privada del entorno", () => {
    const config = loadConfig({ MONGO_URI: "mongodb://x", JWT_PRIVATE_KEY: pem });
    assert.equal(config.jwtPrivateKey.type, "private");
  });
});
